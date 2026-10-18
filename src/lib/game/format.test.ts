import { describe, expect, it } from "vitest";
import { formatClock, formatScore } from "./format";

describe("formatClock", () => {
  it("rounds up and supports hours", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(-5)).toBe("0:00");
    expect(formatClock(1)).toBe("0:01");
    expect(formatClock(59_001)).toBe("1:00");
    expect(formatClock(20 * 60_000)).toBe("20:00");
    expect(formatClock(2 * 3600_000)).toBe("2:00:00");
    expect(formatClock(3600_000 + 65_000)).toBe("1:01:05");
  });
});

describe("formatScore", () => {
  it("trims trailing zeros", () => {
    expect(formatScore(4.5)).toBe("4.5");
    expect(formatScore("4.0000")).toBe("4");
    expect(formatScore(3.3333)).toBe("3.33");
    expect(formatScore(null)).toBe("–");
  });
});
