import { describe, expect, it } from "vitest";
import { boostPlan } from "./audio-graph";

describe("boostPlan", () => {
  it("adds the safety limiter only when the track is boosted", () => {
    expect(boostPlan(6)).toEqual({ db: 6, gain: expect.closeTo(1.995, 3), limiter: true });
  });

  it("passes unmeasured, disabled or loud-enough tracks through untouched", () => {
    expect(boostPlan(0)).toEqual({ db: 0, gain: 1, limiter: false });
    expect(boostPlan(null)).toEqual({ db: 0, gain: 1, limiter: false });
    expect(boostPlan(undefined)).toEqual({ db: 0, gain: 1, limiter: false });
    expect(boostPlan(-3)).toEqual({ db: 0, gain: 1, limiter: false });
    expect(boostPlan(Number.NaN)).toEqual({ db: 0, gain: 1, limiter: false });
  });
});
