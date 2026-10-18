import { describe, expect, it } from "vitest";
import { waveformHeights } from "@/lib/game/waveform";
import { readStoredPeaks, STORED_PEAKS, storedPeaks } from "./peaks";

describe("storedPeaks", () => {
  it("packs shaped waveform heights into 120 bytes", () => {
    const left = Float32Array.from({ length: 12_000 }, (_, i) => Math.sin(i / 10) * (i / 12_000));
    const peaks = storedPeaks(waveformHeights([left]))!;
    expect(peaks).toHaveLength(STORED_PEAKS);
    expect(peaks.every((p) => Number.isInteger(p) && p >= 0 && p <= 255)).toBe(true);
    expect(peaks[0]).toBeLessThan(peaks[STORED_PEAKS - 1]);
  });

  it("stretches short waveforms to fill every bar", () => {
    expect(storedPeaks([0, 1])).toHaveLength(STORED_PEAKS);
  });

  it("has nothing to store without a waveform", () => {
    expect(storedPeaks([])).toBeNull();
  });

  it("reads stored bytes back as 0–1 values", () => {
    expect(readStoredPeaks([0, 255, 51])).toEqual([0, 1, 0.2]);
    expect(readStoredPeaks(null)).toBeNull();
  });
});
