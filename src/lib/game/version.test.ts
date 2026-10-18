import { describe, expect, it } from "vitest";
import { decideVersion } from "./version";

describe("decideVersion", () => {
  it("drops events at or below the local version", () => {
    expect(decideVersion(5, 5)).toBe("stale");
    expect(decideVersion(5, 3)).toBe("stale");
  });

  it("applies the next version", () => {
    expect(decideVersion(5, 6)).toBe("apply");
  });

  it("flags skipped versions and missing local state as gaps", () => {
    expect(decideVersion(5, 8)).toBe("gap");
    expect(decideVersion(null, 1)).toBe("gap");
  });
});
