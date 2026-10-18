const SAMPLE_RATE = 22050;
const BPM = 120;
const PROGRESSION = [
  [0, 4, 7, 11],
  [9, 12, 16, 19],
  [5, 9, 12, 16],
  [7, 11, 14, 17],
];

export type PlaceholderTrack = { bytes: Uint8Array; durationMs: number };

export function placeholderWav({ seconds = 24, seed = 0 }: { seconds?: number; seed?: number } = {}): PlaceholderTrack {
  const frames = Math.round(seconds * SAMPLE_RATE);
  const root = 57 + (((seed % 12) + 12) % 12);
  const noteFrames = Math.round((60 / BPM / 2) * SAMPLE_RATE);
  const view = new DataView(new ArrayBuffer(44 + frames * 2));

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + frames * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, frames * 2, true);

  for (let i = 0; i < frames; i++) {
    const note = Math.floor(i / noteFrames);
    const chord = PROGRESSION[Math.floor(note / 8) % PROGRESSION.length];
    const step = note % 8;
    const interval = chord[step < 4 ? step : 7 - step];
    const freq = 440 * 2 ** ((root + interval - 69) / 12);
    const bass = 440 * 2 ** ((root + chord[0] - 24 - 69) / 12);
    const t = i / SAMPLE_RATE;
    const pos = (i % noteFrames) / noteFrames;
    const envelope = Math.min(1, pos * 50) * (1 - pos) ** 2;
    const fade = Math.min(1, i / SAMPLE_RATE, (frames - i) / SAMPLE_RATE);
    const sample = (0.5 * envelope * Math.sin(2 * Math.PI * freq * t) + 0.25 * Math.sin(2 * Math.PI * bass * t)) * fade;
    view.setInt16(44 + i * 2, Math.round(sample * 0x7fff * 0.8), true);
  }

  return { bytes: new Uint8Array(view.buffer), durationMs: Math.round((frames / SAMPLE_RATE) * 1000) };
}
