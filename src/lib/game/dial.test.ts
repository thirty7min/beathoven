import { describe, expect, it } from "vitest";
import { scoreAngle, scoreFromKey, scoreFromPoint, shouldSend, stepScore } from "./dial";

describe("scoreAngle", () => {
  it("sweeps from left to right across the semicircle", () => {
    expect(scoreAngle(1)).toBe(180);
    expect(scoreAngle(3)).toBe(90);
    expect(scoreAngle(5)).toBe(0);
    expect(scoreAngle(9)).toBe(0);
  });
});

describe("scoreFromPoint", () => {
  it("maps the pointer angle to the nearest score", () => {
    expect(scoreFromPoint(-1, 0)).toBe(1);
    expect(scoreFromPoint(-1, 1)).toBe(2);
    expect(scoreFromPoint(0, 1)).toBe(3);
    expect(scoreFromPoint(1, 1)).toBe(4);
    expect(scoreFromPoint(1, 0)).toBe(5);
  });

  it("snaps points below the center to the nearest end", () => {
    expect(scoreFromPoint(-0.2, -1)).toBe(1);
    expect(scoreFromPoint(0.2, -1)).toBe(5);
  });

  it("treats the exact center as the lowest score", () => {
    expect(scoreFromPoint(0, 0)).toBe(1);
  });
});

describe("stepScore", () => {
  it("steps and clamps", () => {
    expect(stepScore(3, 1)).toBe(4);
    expect(stepScore(5, 1)).toBe(5);
    expect(stepScore(1, -1)).toBe(1);
  });

  it("starts from the matching end when nothing is picked", () => {
    expect(stepScore(null, 1)).toBe(1);
    expect(stepScore(null, -1)).toBe(5);
  });
});

describe("scoreFromKey", () => {
  it("accepts digits 1–5 and arrow keys", () => {
    expect(scoreFromKey("4", null)).toBe(4);
    expect(scoreFromKey("ArrowRight", 2)).toBe(3);
    expect(scoreFromKey("ArrowLeft", 2)).toBe(1);
    expect(scoreFromKey("ArrowUp", 5)).toBe(5);
  });

  it("ignores other keys", () => {
    expect(scoreFromKey("0", 3)).toBeNull();
    expect(scoreFromKey("6", 3)).toBeNull();
    expect(scoreFromKey("a", 3)).toBeNull();
    expect(scoreFromKey("Enter", 3)).toBeNull();
  });
});

describe("shouldSend", () => {
  const base = { value: 4, lastSent: 3, dragging: false, msSinceLastSend: 10 };

  it("sends discrete changes right away", () => {
    expect(shouldSend(base)).toBe(true);
    expect(shouldSend({ ...base, lastSent: null, msSinceLastSend: null })).toBe(true);
  });

  it("skips values that were already sent", () => {
    expect(shouldSend({ ...base, lastSent: 4 })).toBe(false);
    expect(shouldSend({ ...base, lastSent: 4, dragging: true, msSinceLastSend: 5000 })).toBe(false);
  });

  it("throttles sends while dragging", () => {
    expect(shouldSend({ ...base, dragging: true, msSinceLastSend: 100 })).toBe(false);
    expect(shouldSend({ ...base, dragging: true, msSinceLastSend: 300 })).toBe(true);
    expect(shouldSend({ ...base, dragging: true, msSinceLastSend: null })).toBe(true);
  });
});
