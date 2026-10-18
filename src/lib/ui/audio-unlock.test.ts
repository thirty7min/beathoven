import { describe, expect, it } from "vitest";
import { shouldShowResumePill } from "./audio-unlock";

describe("shouldShowResumePill", () => {
  it("shows only when audio was refused while something should be audible", () => {
    expect(shouldShowResumePill({ blocked: true, wantsAudio: true, muted: false })).toBe(true);
  });

  it("stays hidden when nothing is blocked, nothing should play, or sound is muted", () => {
    expect(shouldShowResumePill({ blocked: false, wantsAudio: true, muted: false })).toBe(false);
    expect(shouldShowResumePill({ blocked: true, wantsAudio: false, muted: false })).toBe(false);
    expect(shouldShowResumePill({ blocked: true, wantsAudio: true, muted: true })).toBe(false);
  });
});
