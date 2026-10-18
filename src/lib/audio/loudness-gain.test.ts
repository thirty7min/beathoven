import { describe, expect, it } from "vitest";
import { boostGainDb, dbToGain } from "./loudness-gain";

describe("boostGainDb", () => {
  it("raises quiet tracks to the target when there's headroom", () => {
    expect(boostGainDb({ lufs: -20, truePeakDbtp: -10, enabled: true })).toBe(6);
  });

  it("stops at the true-peak ceiling", () => {
    expect(boostGainDb({ lufs: -20, truePeakDbtp: -3, enabled: true })).toBe(2);
    expect(boostGainDb({ lufs: -20, truePeakDbtp: 0.5, enabled: true })).toBe(0);
  });

  it("caps the boost", () => {
    expect(boostGainDb({ lufs: -40, truePeakDbtp: -30, enabled: true })).toBe(12);
    expect(boostGainDb({ lufs: -40, truePeakDbtp: -30, enabled: true }, { maxBoostDb: 6 })).toBe(6);
  });

  it("never turns loud tracks down", () => {
    expect(boostGainDb({ lufs: -14, truePeakDbtp: -1, enabled: true })).toBe(0);
    expect(boostGainDb({ lufs: -6, truePeakDbtp: 0.8, enabled: true })).toBe(0);
  });

  it("does nothing when off or unmeasured", () => {
    expect(boostGainDb({ lufs: -20, truePeakDbtp: -10, enabled: false })).toBe(0);
    expect(boostGainDb({ lufs: null, truePeakDbtp: -10, enabled: true })).toBe(0);
    expect(boostGainDb({ lufs: -20, truePeakDbtp: undefined, enabled: true })).toBe(0);
  });

  it("honours a custom target and ceiling", () => {
    expect(boostGainDb({ lufs: -20, truePeakDbtp: -10, enabled: true }, { targetLufs: -16, ceilingDbtp: -2 })).toBe(4);
  });
});

describe("dbToGain", () => {
  it("converts decibels to a linear gain", () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(6)).toBeCloseTo(1.995, 3);
  });
});
