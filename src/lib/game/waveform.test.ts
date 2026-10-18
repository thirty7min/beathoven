import { describe, expect, it } from "vitest";
import { downsamplePeaks, playedBars, resamplePeaks } from "./waveform";

describe("downsamplePeaks", () => {
  it("takes the absolute peak per bar and normalizes to the loudest", () => {
    const samples = [0.1, -0.5, 0.2, 0.25, -0.1, 0.05, 0, 0];
    expect(downsamplePeaks([samples], 4)).toEqual([1, 0.5, 0.2, 0]);
  });

  it("merges channels by taking the louder one", () => {
    expect(downsamplePeaks([[0.2, 0], [0, 0.4]], 2)).toEqual([0.5, 1]);
  });

  it("never returns more bars than samples", () => {
    expect(downsamplePeaks([[0.5, 1]], 200)).toEqual([0.5, 1]);
  });

  it("handles silence and empty input", () => {
    expect(downsamplePeaks([[0, 0, 0, 0]], 2)).toEqual([0, 0]);
    expect(downsamplePeaks([], 200)).toEqual([]);
    expect(downsamplePeaks([[]], 200)).toEqual([]);
  });

  it("covers long tracks with exactly the requested bar count", () => {
    const long = Float32Array.from({ length: 1_000_003 }, (_, i) => Math.sin(i / 50));
    const peaks = downsamplePeaks([long], 200);
    expect(peaks).toHaveLength(200);
    expect(Math.max(...peaks)).toBe(1);
  });
});

describe("playedBars", () => {
  it("rounds progress to a bar count and clamps", () => {
    expect(playedBars(200, 0)).toBe(0);
    expect(playedBars(200, 0.5)).toBe(100);
    expect(playedBars(200, 1.4)).toBe(200);
    expect(playedBars(200, -1)).toBe(0);
    expect(playedBars(200, Number.NaN)).toBe(0);
  });
});

describe("resamplePeaks", () => {
  it("keeps the loudest peak of each group", () => {
    expect(resamplePeaks([0.1, 0.9, 0.2, 0.4, 1, 0.3], 3)).toEqual([0.9, 0.4, 1]);
  });

  it("leaves short waveforms alone", () => {
    expect(resamplePeaks([0.5, 1], 48)).toEqual([0.5, 1]);
  });
});
