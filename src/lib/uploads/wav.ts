import type { PcmSink } from "./decode";

const FRAMES_PER_CHUNK = 65_536;
const PCM = 1;
const FLOAT = 3;
const EXTENSIBLE = 0xfffe;

type WavFormat = { format: number; channels: number; sampleRate: number; bits: number; blockAlign: number };

function ascii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function readFormat(fmt: DataView): WavFormat | null {
  if (fmt.byteLength < 16) return null;
  let format = fmt.getUint16(0, true);
  if (format === EXTENSIBLE) {
    if (fmt.byteLength < 26) return null;
    format = fmt.getUint16(24, true);
  }
  const channels = fmt.getUint16(2, true);
  const sampleRate = fmt.getUint32(4, true);
  const blockAlign = fmt.getUint16(12, true);
  const bits = fmt.getUint16(14, true);
  const valid =
    channels > 0 &&
    sampleRate > 0 &&
    blockAlign === (channels * bits) / 8 &&
    ((format === PCM && [8, 16, 24, 32].includes(bits)) || (format === FLOAT && [32, 64].includes(bits)));
  return valid ? { format, channels, sampleRate, bits, blockAlign } : null;
}

function sampleReader(view: DataView, { format, bits }: WavFormat): (offset: number) => number {
  if (format === FLOAT) return bits === 32 ? (o) => view.getFloat32(o, true) : (o) => view.getFloat64(o, true);
  if (bits === 8) return (o) => (view.getUint8(o) - 128) / 128;
  if (bits === 16) return (o) => view.getInt16(o, true) / 32_768;
  if (bits === 24) return (o) => ((view.getUint8(o) | (view.getUint8(o + 1) << 8) | (view.getInt8(o + 2) << 16)) / 8_388_608);
  return (o) => view.getInt32(o, true) / 2_147_483_648;
}

export function decodeWav(bytes: Uint8Array, sink: PcmSink): void {
  if (bytes.length < 12 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") throw new Error("not a wav file");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let format: WavFormat | null = null;
  let data: { offset: number; length: number } | null = null;
  for (let offset = 12; offset + 8 <= bytes.length; ) {
    const id = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const length = Math.min(size, bytes.length - offset - 8);
    if (id === "fmt " && !format) format = readFormat(new DataView(bytes.buffer, bytes.byteOffset + offset + 8, length));
    if (id === "data" && !data) data = { offset: offset + 8, length };
    offset += 8 + size + (size % 2);
  }
  if (!format || !data) throw new Error("unsupported wav file");

  const read = sampleReader(view, format);
  const bytesPerSample = format.bits / 8;
  const totalFrames = Math.floor(data.length / format.blockAlign);
  for (let start = 0; start < totalFrames; start += FRAMES_PER_CHUNK) {
    const frames = Math.min(FRAMES_PER_CHUNK, totalFrames - start);
    const channelData = Array.from({ length: format.channels }, () => new Float32Array(frames));
    for (let i = 0; i < frames; i++) {
      const frameOffset = data.offset + (start + i) * format.blockAlign;
      for (let c = 0; c < format.channels; c++) channelData[c][i] = read(frameOffset + c * bytesPerSample);
    }
    sink(channelData, format.sampleRate);
  }
}
