import { describe, expect, it } from "vitest";
import {
  BAR_GAP_PX,
  BAR_WIDTH_PX,
  MIN_BAR_HEIGHT,
  barCount,
  playedBars,
  resampleHeights,
  shapeWaveform,
  waveformEnvelope,
  waveformHeights,
} from "./waveform";

function compressedMaster(seconds: number, quietFrom: number, quietTo: number, sampleRate = 8000) {
  return Float32Array.from({ length: seconds * sampleRate }, (_, i) => {
    const t = i / sampleRate;
    const level = t >= quietFrom && t < quietTo ? 0.5 : 0.88 + 0.06 * Math.sin(t * 7);
    return Math.max(-0.98, Math.min(0.98, level * Math.sin(i * 0.37) * 1.4));
  });
}

describe("waveformEnvelope", () => {
  it("blends RMS with the peak per bucket", () => {
    const square = Float32Array.from({ length: 400 }, (_, i) => (i % 2 ? 0.5 : -0.5));
    const spiky = Float32Array.from({ length: 400 }, (_, i) => (i % 100 === 0 ? 0.5 : 0));
    const [steady] = waveformEnvelope([square], 1);
    const [spike] = waveformEnvelope([spiky], 1);
    expect(steady).toBeCloseTo(0.5);
    expect(spike).toBeLessThan(steady / 2);
  });

  it("never returns more buckets than samples and handles empty input", () => {
    expect(waveformEnvelope([Float32Array.from([0.1, 0.2])], 10)).toHaveLength(2);
    expect(waveformEnvelope([], 10)).toEqual([]);
  });
});

describe("shapeWaveform", () => {
  it("shows the dynamics of a heavily compressed master with a quieter section", () => {
    const heights = waveformHeights([compressedMaster(20, 8, 12)], 200);
    const range = Math.max(...heights) - Math.min(...heights);
    expect(range).toBeGreaterThanOrEqual(0.4);
  });

  it("keeps silence visible as a dot", () => {
    expect(shapeWaveform([0, 0, 0])).toEqual([MIN_BAR_HEIGHT, MIN_BAR_HEIGHT, MIN_BAR_HEIGHT]);
    expect(Math.min(...shapeWaveform([0, 0.5, 1]))).toBe(MIN_BAR_HEIGHT);
  });

  it("stays within the bar box", () => {
    const heights = shapeWaveform([0.1, 0.4, 2, 0.9]);
    expect(heights.every((h) => h >= MIN_BAR_HEIGHT && h <= 1)).toBe(true);
  });
});

describe("resampleHeights", () => {
  it("averages when there are fewer bars", () => {
    expect(resampleHeights([0.2, 0.4, 0.6, 0.8], 2)).toEqual([0.30000000000000004, 0.7]);
  });

  it("interpolates smoothly when there are more bars", () => {
    expect(resampleHeights([0, 1], 5)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(resampleHeights([0.4], 3)).toEqual([0.4, 0.4, 0.4]);
  });

  it("handles empty input", () => {
    expect(resampleHeights([], 10)).toEqual([]);
    expect(resampleHeights([0.5], 0)).toEqual([]);
  });
});

describe("barCount", () => {
  it("fits thin bars to the width", () => {
    expect(barCount(900)).toBe(Math.floor((900 + BAR_GAP_PX) / (BAR_WIDTH_PX + BAR_GAP_PX)));
    expect(barCount(900)).toBeGreaterThanOrEqual(250);
    expect(barCount(320)).toBeGreaterThanOrEqual(90);
    expect(barCount(0)).toBe(0);
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
