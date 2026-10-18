import { describe, expect, it } from "vitest";
import { placeholderWav } from "./placeholder-wav";

const text = (bytes: Uint8Array, offset: number) => String.fromCharCode(...bytes.slice(offset, offset + 4));

describe("placeholderWav", () => {
  it("writes a valid mono 16-bit PCM RIFF header", () => {
    const { bytes } = placeholderWav({ seconds: 2 });
    const view = new DataView(bytes.buffer);
    expect(text(bytes, 0)).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(bytes.length - 8);
    expect(text(bytes, 8)).toBe("WAVE");
    expect(text(bytes, 12)).toBe("fmt ");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint16(34, true)).toBe(16);
    expect(text(bytes, 36)).toBe("data");
    expect(view.getUint32(40, true)).toBe(bytes.length - 44);
  });

  it("matches the requested length", () => {
    const { bytes, durationMs } = placeholderWav({ seconds: 24 });
    const view = new DataView(bytes.buffer);
    const rate = view.getUint32(24, true);
    expect(durationMs).toBe(24000);
    expect(view.getUint32(40, true) / 2 / rate).toBeCloseTo(24, 3);
  });

  it("is audible, never clips, and varies by seed", () => {
    const a = placeholderWav({ seconds: 3, seed: 0 }).bytes;
    const b = placeholderWav({ seconds: 3, seed: 5 }).bytes;
    const samples = new Int16Array(a.buffer.slice(44));
    const peak = Math.max(...Array.from(samples, Math.abs));
    expect(peak).toBeGreaterThan(1000);
    expect(peak).toBeLessThan(0x7fff);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });
});
