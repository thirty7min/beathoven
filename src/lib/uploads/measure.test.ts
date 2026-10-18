import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { measureAudioLoudness } from "./measure";

vi.mock("server-only", () => ({}));

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/loudness/${name}`, import.meta.url)));

function wavTone(bits: 16 | 24 | 32, float = false) {
  const rate = 48_000;
  const frames = rate * 3;
  const bytesPerSample = bits / 8;
  const blockAlign = 2 * bytesPerSample;
  const out = new Uint8Array(44 + frames * blockAlign);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode("RIFF"), 0);
  view.setUint32(4, out.length - 8, true);
  out.set(new TextEncoder().encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, float ? 3 : 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bits, true);
  out.set(new TextEncoder().encode("data"), 36);
  view.setUint32(40, frames * blockAlign, true);
  for (let i = 0; i < frames; i++) {
    const v = 0.1 * Math.sin((2 * Math.PI * 1000 * i) / rate);
    for (let c = 0; c < 2; c++) {
      const o = 44 + i * blockAlign + c * bytesPerSample;
      if (float) view.setFloat32(o, v, true);
      else if (bits === 16) view.setInt16(o, Math.round(v * 32_767), true);
      else if (bits === 24) {
        const s = Math.round(v * 8_388_607);
        view.setUint8(o, s & 0xff);
        view.setUint8(o + 1, (s >> 8) & 0xff);
        view.setInt8(o + 2, s >> 16);
      } else view.setInt32(o, Math.round(v * 2_147_483_647), true);
    }
  }
  return out;
}

const expectTone = ({ lufs, truePeakDbtp }: { lufs: number | null; truePeakDbtp: number | null }) => {
  expect(lufs!).toBeGreaterThan(-20.5);
  expect(lufs!).toBeLessThan(-19.5);
  expect(truePeakDbtp!).toBeGreaterThan(-20.6);
  expect(truePeakDbtp!).toBeLessThan(-19.4);
};

describe("measureAudioLoudness", () => {
  it.each([
    [16, false],
    [24, false],
    [32, false],
    [32, true],
  ] as const)("reads %i-bit WAV (float %s)", async (bits, float) => {
    expectTone(await measureAudioLoudness(wavTone(bits, float), "wav"));
  });

  it.each([
    ["tone.flac", "flac"],
    ["tone.m4a", "m4a"],
    ["tone.aac", "aac"],
    ["tone.opus", "ogg"],
  ])("decodes %s", async (name, ext) => {
    expectTone(await measureAudioLoudness(fixture(name), ext));
  });

  it("decodes MP3 within codec tolerance of the mono source, played as dual mono", async () => {
    const sourceLufs = -16.33;
    const { lufs, truePeakDbtp } = await measureAudioLoudness(fixture("music.mp3"), "mp3");
    expect(Math.abs(lufs! - (sourceLufs + 3.01))).toBeLessThan(1);
    expect(Math.abs(truePeakDbtp! - -1.14)).toBeLessThan(1);
  });

  it("fails on unsupported codecs and garbage instead of guessing", async () => {
    await expect(measureAudioLoudness(fixture("tone-alac.m4a"), "m4a")).rejects.toThrow();
    await expect(measureAudioLoudness(new Uint8Array(100), "wav")).rejects.toThrow();
    await expect(measureAudioLoudness(new Uint8Array(10), "xyz")).rejects.toThrow();
  });
});
