import { crc32, deflateSync } from "node:zlib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { placeholderWav } from "@/lib/game/placeholder-wav";
import { MAX_AVATAR_BYTES } from "./avatar";
import { rebuildWav, stripMp3Tags, verifyAudio } from "./audio";
import { sha256Hex, verifyUpload } from "./verify";

const text = (s: string) => new TextEncoder().encode(s);
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};
const notBlocked = async () => false;

function mp3Frames(seconds: number) {
  const frameLength = 417;
  const frames = Math.ceil((seconds * 44100) / 1152);
  const out = new Uint8Array(frames * frameLength);
  for (let i = 0; i < frames; i++) out.set([0xff, 0xfb, 0x90, 0x64], i * frameLength);
  return out;
}

function id3v2(payload: Uint8Array) {
  const size = payload.length;
  const header = new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, (size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]);
  return concat(header, payload);
}

function id3v1() {
  const tag = new Uint8Array(128);
  tag.set(text("TAGtitle"), 0);
  return tag;
}

function wavChunk(id: string, body: Uint8Array) {
  const head = new Uint8Array(8);
  head.set(text(id), 0);
  new DataView(head.buffer).setUint32(4, body.length, true);
  return concat(head, body, body.length % 2 ? new Uint8Array(1) : new Uint8Array(0));
}

function pngChunk(type: string, body: Uint8Array) {
  const typed = concat(text(type), body);
  const chunk = new Uint8Array(4 + typed.length + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, body.length);
  chunk.set(typed, 4);
  view.setUint32(4 + typed.length, crc32(typed));
  return chunk;
}

function hugePng(width: number, height: number) {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return concat(
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(new Uint8Array(100))),
    pngChunk("IEND", new Uint8Array(0)),
  );
}

describe("audio verification", () => {
  it("accepts a real WAV and takes the duration from the parse", async () => {
    const result = await verifyAudio(placeholderWav({ seconds: 4 }).bytes);
    expect(result).toMatchObject({ ok: true, ext: "wav", mime: "audio/wav", durationMs: 4000, channels: 1, sampleRate: 22050 });
  });

  it("rebuilds WAVs with only fmt and data chunks", async () => {
    const original = placeholderWav({ seconds: 4 }).bytes;
    const fmt = original.subarray(20, 36);
    const data = original.subarray(44);
    const body = concat(text("WAVE"), wavChunk("LIST", text("INFOIART<script>alert(1)</script>")), wavChunk("fmt ", fmt), wavChunk("data", data), wavChunk("id3 ", text("junk")));
    const head = new Uint8Array(8);
    head.set(text("RIFF"), 0);
    new DataView(head.buffer).setUint32(4, body.length, true);
    const rebuilt = rebuildWav(concat(head, body))!;
    expect(Buffer.from(rebuilt).equals(Buffer.from(original))).toBe(true);
    expect(Buffer.from(rebuilt).includes("script")).toBe(false);
  });

  it("accepts MPEG frames and strips ID3v2, ID3v1 and APE tags down to the frames", async () => {
    const frames = mp3Frames(4);
    const apeFooter = new Uint8Array(32);
    apeFooter.set(text("APETAGEX"), 0);
    new DataView(apeFooter.buffer).setUint32(12, 32, true);
    const tagged = concat(id3v2(concat(text("APIC\u0000\u0000\u0010\u0000\u0000image/png"), new Uint8Array(4000).fill(7))), frames, apeFooter, id3v1());
    expect(Buffer.from(stripMp3Tags(tagged)!).equals(Buffer.from(frames))).toBe(true);
    const result = await verifyAudio(tagged);
    expect(result).toMatchObject({ ok: true, ext: "mp3", mime: "audio/mpeg" });
    if (!result.ok) throw new Error("expected ok");
    expect(Math.abs(result.durationMs - 4000)).toBeLessThan(100);
    expect(Buffer.from(result.bytes).equals(Buffer.from(frames))).toBe(true);
  });

  it("rejects HTML renamed to .mp3", async () => {
    expect(await verifyAudio(text("<!doctype html><html><script>alert(1)</script></html>".repeat(50)))).toEqual({
      ok: false,
      reason: "unsupported_audio",
    });
  });

  it("rejects ID3 or MPEG headers wrapped around other content", async () => {
    const html = text("<html><script>alert(1)</script></html>".repeat(5000));
    expect((await verifyAudio(concat(id3v2(text("TIT2junk")), html))).ok).toBe(false);
    const polyglot = concat(id3v2(text("TIT2junk")), mp3Frames(0.1), html);
    expect(await verifyAudio(polyglot)).toEqual({ ok: false, reason: "corrupt_file" });
  });

  it("rejects malformed WAVs and truncated audio", async () => {
    const wav = placeholderWav({ seconds: 4 }).bytes.slice();
    new DataView(wav.buffer).setUint16(22, 0, true);
    expect(await verifyAudio(wav)).toEqual({ ok: false, reason: "corrupt_file" });
    expect(await verifyAudio(placeholderWav({ seconds: 4 }).bytes.slice(0, 40))).toEqual({ ok: false, reason: "corrupt_file" });
    expect(await verifyAudio(mp3Frames(4).slice(0, 4000))).toEqual({ ok: false, reason: "audio_too_short" });
  });

  it("enforces 3s to 15min", async () => {
    expect(await verifyAudio(placeholderWav({ seconds: 2 }).bytes)).toEqual({ ok: false, reason: "audio_too_short" });
    const long = new Uint8Array(44 + 8000 * 60 * 16);
    long.set(placeholderWav({ seconds: 1 }).bytes.subarray(0, 44));
    const view = new DataView(long.buffer);
    view.setUint32(4, long.length - 8, true);
    view.setUint32(24, 8000, true);
    view.setUint32(28, 8000, true);
    view.setUint16(32, 1, true);
    view.setUint16(34, 8, true);
    view.setUint32(40, long.length - 44, true);
    expect(await verifyAudio(long)).toEqual({ ok: false, reason: "audio_too_long" });
  });
});

describe("avatar verification", () => {
  it("re-encodes to a 256px webp with no metadata", async () => {
    const jpeg = await sharp({ create: { width: 800, height: 500, channels: 3, background: "#336699" } })
      .jpeg()
      .withExif({ IFD0: { Copyright: "secret" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 0/1" } })
      .toBuffer();
    expect((await sharp(jpeg).metadata()).exif).toBeDefined();
    const result = await verifyUpload("avatar", new Uint8Array(jpeg), notBlocked);
    expect(result).toMatchObject({ ok: true, mime: "image/webp", sha256: sha256Hex(new Uint8Array(jpeg)) });
    if (!result.ok) throw new Error("expected ok");
    const meta = await sharp(result.bytes).metadata();
    expect(meta).toMatchObject({ format: "webp", width: 256, height: 256 });
    expect(meta.exif).toBeUndefined();
  });

  it("takes only the first frame of an animated GIF", async () => {
    const gif = await sharp({ create: { width: 64, height: 128, channels: 4, background: "#ff0000" } })
      .gif()
      .toBuffer();
    const result = await verifyUpload("avatar", new Uint8Array(gif), notBlocked);
    if (!result.ok) throw new Error("expected ok");
    expect((await sharp(result.bytes).metadata()).pages ?? 1).toBe(1);
  });

  it("rejects SVG and image polyglots", async () => {
    const svg = text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(await verifyUpload("avatar", svg, notBlocked)).toMatchObject({ ok: false, reason: "unsupported_image" });
    const polyglot = concat(text("GIF89a"), text("<script>alert(1)</script>".repeat(20)));
    expect(await verifyUpload("avatar", polyglot, notBlocked)).toMatchObject({ ok: false, reason: "corrupt_file" });
  });

  it("rejects image bombs from the header alone, and oversized files", async () => {
    expect(await verifyUpload("avatar", hugePng(50_000, 50_000), notBlocked)).toMatchObject({
      ok: false,
      reason: "file_too_large",
    });
    expect(await verifyUpload("avatar", new Uint8Array(MAX_AVATAR_BYTES + 1), notBlocked)).toMatchObject({
      ok: false,
      reason: "file_too_large",
    });
  });
});

describe("blocklist", () => {
  it("refuses files whose hash is blocked before parsing them", async () => {
    const wav = placeholderWav({ seconds: 4 }).bytes;
    const hash = sha256Hex(wav);
    const result = await verifyUpload("submission", wav, async (sha) => sha === hash);
    expect(result).toEqual({ ok: false, reason: "blocked_file", sha256: hash, size: wav.length });
  });
});
