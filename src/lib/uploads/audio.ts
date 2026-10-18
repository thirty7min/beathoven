import { fileTypeFromBuffer } from "file-type";
import { parseBuffer } from "music-metadata";
import { reject, type Rejected } from "./reasons";

export const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
export const MIN_AUDIO_MS = 3_000;
export const MAX_AUDIO_MS = 15 * 60_000;

const AUDIO_BY_EXTENSION: Record<string, { ext: string; mime: string }> = {
  mp3: { ext: "mp3", mime: "audio/mpeg" },
  wav: { ext: "wav", mime: "audio/wav" },
  flac: { ext: "flac", mime: "audio/flac" },
  ogg: { ext: "ogg", mime: "audio/ogg" },
  oga: { ext: "ogg", mime: "audio/ogg" },
  opus: { ext: "ogg", mime: "audio/ogg" },
  m4a: { ext: "m4a", mime: "audio/mp4" },
  mp4: { ext: "m4a", mime: "audio/mp4" },
  aac: { ext: "aac", mime: "audio/aac" },
};

export type VerifiedAudio = {
  ok: true;
  bytes: Uint8Array;
  ext: string;
  mime: string;
  durationMs: number;
  codec: string | null;
  sampleRate: number;
  channels: number;
  title: string | null;
};

export async function verifyAudio(input: Uint8Array): Promise<VerifiedAudio | Rejected> {
  if (input.byteLength > MAX_AUDIO_BYTES) return reject("file_too_large");
  const detected = await fileTypeFromBuffer(input);
  const target = detected && AUDIO_BY_EXTENSION[detected.ext];
  if (!detected || !target) return reject("unsupported_audio");

  const bytes = target.ext === "mp3" ? stripMp3Tags(input) : target.ext === "wav" ? rebuildWav(input) : input;
  if (!bytes) return reject("corrupt_file");

  let format;
  try {
    ({ format } = await parseBuffer(bytes, { mimeType: target.mime, size: bytes.byteLength }, { duration: true, skipCovers: true }));
  } catch {
    return reject("corrupt_file");
  }
  if (detected.ext === "mp4" && (format.hasVideo || format.hasAudio === false)) return reject("unsupported_audio");
  if (!format.duration || !Number.isFinite(format.duration) || !format.sampleRate || !format.numberOfChannels) {
    return reject("corrupt_file");
  }

  const durationMs = Math.round(format.duration * 1000);
  if (durationMs < MIN_AUDIO_MS) return reject("audio_too_short");
  if (durationMs > MAX_AUDIO_MS) return reject("audio_too_long");
  return {
    ok: true,
    bytes,
    ext: target.ext,
    mime: target.mime,
    durationMs,
    codec: format.codec ?? null,
    sampleRate: format.sampleRate,
    channels: format.numberOfChannels,
    title: await readTitleTag(input, target.mime),
  };
}

async function readTitleTag(input: Uint8Array, mimeType: string): Promise<string | null> {
  try {
    const { common } = await parseBuffer(input, { mimeType, size: input.byteLength }, { duration: false, skipCovers: true });
    return typeof common.title === "string" ? common.title : null;
  } catch {
    return null;
  }
}

const ascii = (bytes: Uint8Array, offset: number, length: number) =>
  String.fromCharCode(...bytes.subarray(offset, offset + length));

const isFrameSync = (bytes: Uint8Array, offset: number) =>
  offset + 1 < bytes.length && bytes[offset] === 0xff && (bytes[offset + 1] & 0xe0) === 0xe0;

export function stripMp3Tags(bytes: Uint8Array): Uint8Array | null {
  let start = 0;
  let end = bytes.length;
  while (end - start >= 10 && ascii(bytes, start, 3) === "ID3") {
    const size = (bytes[start + 6] << 21) | (bytes[start + 7] << 14) | (bytes[start + 8] << 7) | bytes[start + 9];
    const footer = bytes[start + 5] & 0x10 ? 10 : 0;
    start += 10 + size + footer;
  }
  if (end - start >= 128 && ascii(bytes, end - 128, 3) === "TAG") end -= 128;
  if (end - start >= 32 && ascii(bytes, end - 32, 8) === "APETAGEX") {
    const view = new DataView(bytes.buffer, bytes.byteOffset + end - 32, 32);
    const hasHeader = (view.getUint32(20, true) & 0x80000000) !== 0;
    end -= view.getUint32(12, true) + (hasHeader ? 32 : 0);
  }
  if (end <= start || !isFrameSync(bytes, start)) return null;
  const frames = bytes.slice(start, end);
  return mpegFrameCoverage(frames) >= MIN_FRAME_COVERAGE ? frames : null;
}

const MIN_FRAME_COVERAGE = 0.9;
const BITRATES: Record<string, number[]> = {
  "1-1": [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  "1-2": [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  "1-3": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  "2-1": [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  "2-2": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  "2-3": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000],
};

function mpegFrameLength(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length || !isFrameSync(bytes, offset)) return 0;
  const version = (bytes[offset + 1] >> 3) & 3;
  const layer = 4 - ((bytes[offset + 1] >> 1) & 3);
  const bitrateIndex = bytes[offset + 2] >> 4;
  const rateIndex = (bytes[offset + 2] >> 2) & 3;
  const padding = (bytes[offset + 2] >> 1) & 1;
  if (version === 1 || layer === 4 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return 0;
  const bitrate = BITRATES[`${version === 3 ? 1 : 2}-${layer}`][bitrateIndex] * 1000;
  const sampleRate = SAMPLE_RATES[version][rateIndex];
  if (layer === 1) return Math.floor((12 * bitrate) / sampleRate + padding) * 4;
  const coefficient = layer === 3 && version !== 3 ? 72 : 144;
  return Math.floor((coefficient * bitrate) / sampleRate) + padding;
}

export function mpegFrameCoverage(bytes: Uint8Array): number {
  let covered = 0;
  let offset = 0;
  while (offset < bytes.length) {
    const length = mpegFrameLength(bytes, offset);
    if (length > 0 && offset + length <= bytes.length) {
      covered += length;
      offset += length;
    } else if (length > 0) {
      covered += bytes.length - offset;
      break;
    } else {
      offset += 1;
    }
  }
  return bytes.length === 0 ? 0 : covered / bytes.length;
}

const WAV_FORMATS = new Set([1, 3, 0xfffe]);

export function rebuildWav(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 12 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let fmt: Uint8Array | null = null;
  let data: Uint8Array | null = null;
  for (let offset = 12; offset + 8 <= bytes.length; ) {
    const id = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = bytes.subarray(offset + 8, Math.min(bytes.length, offset + 8 + size));
    if (id === "fmt " && !fmt) fmt = body;
    if (id === "data" && !data) data = body;
    offset += 8 + size + (size % 2);
  }
  if (!fmt || !data || fmt.length < 16) return null;

  const fmtView = new DataView(fmt.buffer, fmt.byteOffset, fmt.byteLength);
  const formatTag = fmtView.getUint16(0, true);
  const channels = fmtView.getUint16(2, true);
  const sampleRate = fmtView.getUint32(4, true);
  const blockAlign = fmtView.getUint16(12, true);
  const bitsPerSample = fmtView.getUint16(14, true);
  if (
    !WAV_FORMATS.has(formatTag) ||
    channels < 1 ||
    channels > 8 ||
    sampleRate < 8000 ||
    sampleRate > 384000 ||
    ![8, 16, 24, 32].includes(bitsPerSample) ||
    blockAlign !== (channels * bitsPerSample) / 8
  ) {
    return null;
  }

  const fmtLength = formatTag === 0xfffe ? 40 : 16;
  if (fmt.length < fmtLength) return null;
  const dataLength = data.length - (data.length % blockAlign);
  if (dataLength === 0) return null;

  const out = new Uint8Array(12 + 8 + fmtLength + 8 + dataLength);
  const outView = new DataView(out.buffer);
  out.set(new TextEncoder().encode("RIFF"), 0);
  outView.setUint32(4, out.length - 8, true);
  out.set(new TextEncoder().encode("WAVEfmt "), 8);
  outView.setUint32(16, fmtLength, true);
  out.set(fmt.subarray(0, fmtLength), 20);
  out.set(new TextEncoder().encode("data"), 20 + fmtLength);
  outView.setUint32(24 + fmtLength, dataLength, true);
  out.set(data.subarray(0, dataLength), 28 + fmtLength);
  return out;
}
