import { describe, expect, it } from "vitest";
import { joinedLabel } from "./joined";

describe("joinedLabel", () => {
  it("uses the short month and year", () => {
    expect(joinedLabel("2026-10-18T12:00:00Z")).toBe("Joined Oct 2026");
  });

  it("hides an unreadable date", () => {
    expect(joinedLabel("nope")).toBeNull();
  });
});
