import { describe, expect, it } from "vitest";
import { pointsLabel, totalPoints } from "./points";

describe("totalPoints", () => {
  it("recovers the integer sum from a rounded average", () => {
    expect(totalPoints(3.3333, 3)).toBe(10);
    expect(totalPoints("4.1429", 7)).toBe(29);
    expect(totalPoints(3, 4)).toBe(12);
  });

  it("has no total without votes", () => {
    expect(totalPoints(null, 0)).toBeNull();
    expect(totalPoints(4, 0)).toBeNull();
    expect(totalPoints("nope", 2)).toBeNull();
  });
});

describe("pointsLabel", () => {
  it("pluralises", () => {
    expect(pointsLabel(12)).toBe("12 points");
    expect(pointsLabel(1)).toBe("1 point");
    expect(pointsLabel(null)).toBe("No points");
  });
});
