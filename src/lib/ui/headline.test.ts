import { describe, expect, it } from "vitest";
import { fitFontSize, joinNames, longestWordLength } from "./headline";

describe("longestWordLength", () => {
  it("measures the longest unbreakable word across names", () => {
    expect(longestWordLength(["casemusicthebesteverlol", "casetest"])).toBe(23);
    expect(longestWordLength(["DJ Big Name"])).toBe(4);
    expect(longestWordLength([])).toBe(1);
  });
});

describe("fitFontSize", () => {
  it("shrinks so the longest word fits the container, within min and max", () => {
    expect(fitFontSize(["casemusicthebesteverlol"], { minRem: 1.5, maxRem: 6, capCqi: 14 })).toBe("clamp(1.5rem, min(6.79cqi, 14cqi), 6rem)");
    expect(fitFontSize(["bob"], { minRem: 1.5, maxRem: 6, capCqi: 14 })).toBe("clamp(1.5rem, min(52.08cqi, 14cqi), 6rem)");
  });

  it("fits the whole name on one line next to an avatar when asked", () => {
    expect(fitFontSize(["DJ Big Name"], { minRem: 1.75, maxRem: 5.5, capCqi: 13, singleLine: true, extraEm: 1.3 })).toBe(
      "clamp(1.75rem, min(11.99cqi, 13cqi), 5.5rem)",
    );
  });

  it("accounts for the share of the row the text gets", () => {
    expect(fitFontSize(["abcdefghij"], { minRem: 1, maxRem: 5, capCqi: 12, share: 0.8 })).toBe("clamp(1rem, min(12.5cqi, 12cqi), 5rem)");
  });
});

describe("joinNames", () => {
  it("joins two names with an ampersand and three or more with commas", () => {
    expect(joinNames(["a"])).toBe("a");
    expect(joinNames(["a", "b"])).toBe("a & b");
    expect(joinNames(["a", "b", "c"])).toBe("a, b & c");
    expect(joinNames([])).toBe("");
  });
});
