import { describe, expect, it } from "vitest";
import { Backoff, backoffDelay } from "./backoff";

describe("backoffDelay", () => {
  it("doubles from the base and caps at the max", () => {
    expect([0, 1, 2, 3, 4, 5, 10].map((n) => backoffDelay(n))).toEqual([1000, 2000, 4000, 8000, 15000, 15000, 15000]);
  });

  it("honours a custom base and cap", () => {
    expect([0, 1, 2, 3, 4].map((n) => backoffDelay(n, 500, 3000))).toEqual([500, 1000, 2000, 3000, 3000]);
  });

  it("treats negative attempts as the first", () => {
    expect(backoffDelay(-3)).toBe(1000);
  });

  it("stays finite for huge attempt counts", () => {
    expect(backoffDelay(10_000)).toBe(15000);
  });
});

describe("Backoff", () => {
  it("advances on each call and restarts after reset", () => {
    const backoff = new Backoff(1000, 4000);
    expect([backoff.next(), backoff.next(), backoff.next(), backoff.next()]).toEqual([1000, 2000, 4000, 4000]);
    backoff.reset();
    expect(backoff.next()).toBe(1000);
  });
});
