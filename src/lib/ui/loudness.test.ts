import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MIN_WAVE_SCALE, playbackBoostDb, waveformBoostScale } from "./loudness";

const features = vi.hoisted(() => ({ LOUDNESS_BOOST_ENABLED: false }));
vi.mock("@/lib/features", () => features);

describe("playbackBoostDb with the boost feature off", () => {
  it("never boosts, so no limiter is inserted and the waveform keeps full height", () => {
    const quiet = { loudness_lufs: -20, true_peak_dbtp: -8, loudness_boost: true };
    expect(playbackBoostDb(quiet)).toBe(0);
    expect(playbackBoostDb(quiet, true)).toBe(0);
    expect(waveformBoostScale(playbackBoostDb(quiet, true), false)).toBe(1);
  });
});

describe("playbackBoostDb", () => {
  beforeEach(() => {
    features.LOUDNESS_BOOST_ENABLED = true;
  });
  afterEach(() => {
    features.LOUDNESS_BOOST_ENABLED = false;
  });

  it("boosts quiet tracks the producer left boost on", () => {
    expect(playbackBoostDb({ loudness_lufs: -20, true_peak_dbtp: -8, loudness_boost: true })).toBeCloseTo(6);
  });

  it("is flat when boost is off, unmeasured or already loud", () => {
    expect(playbackBoostDb({ loudness_lufs: -20, true_peak_dbtp: -8, loudness_boost: false })).toBe(0);
    expect(playbackBoostDb({ loudness_lufs: null, true_peak_dbtp: null, loudness_boost: true })).toBe(0);
    expect(playbackBoostDb({ loudness_lufs: -9, true_peak_dbtp: -0.2, loudness_boost: true })).toBe(0);
    expect(playbackBoostDb(null)).toBe(0);
  });

  it("lets the editor preview an unsaved toggle", () => {
    expect(playbackBoostDb({ loudness_lufs: -20, true_peak_dbtp: -8, loudness_boost: false }, true)).toBeCloseTo(6);
  });
});

describe("waveformBoostScale", () => {
  it("draws the boosted waveform at full height", () => {
    expect(waveformBoostScale(6, true)).toBe(1);
  });

  it("shrinks the bars by the boost gain when boost is off", () => {
    expect(waveformBoostScale(6, false)).toBeCloseTo(0.501, 3);
  });

  it("leaves tracks that need no boost untouched", () => {
    expect(waveformBoostScale(0, false)).toBe(1);
    expect(waveformBoostScale(Number.NaN, false)).toBe(1);
  });

  it("never shrinks past a readable floor", () => {
    expect(waveformBoostScale(24, false)).toBe(MIN_WAVE_SCALE);
  });
});
