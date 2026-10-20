import { describe, expect, it } from "vitest";
import { isNearBottom, nextStuck } from "./stick-to-bottom";

const at = (scrollTop: number) => ({ scrollTop, scrollHeight: 1000, clientHeight: 400 });

describe("isNearBottom", () => {
  it("is true at the bottom and within the threshold", () => {
    expect(isNearBottom(at(600))).toBe(true);
    expect(isNearBottom(at(552))).toBe(true);
  });

  it("is false once scrolled further up", () => {
    expect(isNearBottom(at(551))).toBe(false);
    expect(isNearBottom(at(0))).toBe(false);
  });

  it("is true when the content fits without scrolling", () => {
    expect(isNearBottom({ scrollTop: 0, scrollHeight: 300, clientHeight: 400 })).toBe(true);
  });

  it("accepts a custom threshold", () => {
    expect(isNearBottom(at(500), 100)).toBe(true);
    expect(isNearBottom(at(499), 100)).toBe(false);
  });
});

describe("nextStuck", () => {
  it("sticks whenever the view is near the bottom", () => {
    expect(nextStuck(false, 0, at(580))).toBe(true);
  });

  it("unsticks when the user scrolls up past the threshold", () => {
    expect(nextStuck(true, 600, at(400))).toBe(false);
  });

  it("stays stuck when content grows under a pinned view without the user scrolling", () => {
    expect(nextStuck(true, 600, { scrollTop: 600, scrollHeight: 1200, clientHeight: 400 })).toBe(true);
  });

  it("stays unstuck while scrolling down but not yet near the bottom", () => {
    expect(nextStuck(false, 100, at(300))).toBe(false);
  });
});
