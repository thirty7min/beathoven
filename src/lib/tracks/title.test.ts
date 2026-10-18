import { describe, expect, it } from "vitest";
import { MAX_TRACK_TITLE, cleanTrackTitle, defaultTrackTitle, titleFromFileName } from "./title";

describe("track titles", () => {
  it("prefers the metadata title tag", () => {
    expect(defaultTrackTitle("  Night  Drive ", "final_v3.wav")).toBe("Night Drive");
  });

  it("falls back to the file name without its extension", () => {
    expect(defaultTrackTitle(null, "night_drive_v3.wav")).toBe("night drive v3");
    expect(defaultTrackTitle("   ", "C:\\beats\\Lo-Fi Thing.MP3")).toBe("Lo-Fi Thing");
    expect(titleFromFileName("no-extension")).toBe("no-extension");
    expect(defaultTrackTitle(null, null)).toBeNull();
    expect(defaultTrackTitle(null, ".wav")).toBeNull();
  });

  it("strips control and bidi characters and caps the length", () => {
    expect(cleanTrackTitle("evil\u202etxt.exe\u0000 beat")).toBe("evil txt.exe beat");
    expect(cleanTrackTitle("😀".repeat(100))).toHaveLength(MAX_TRACK_TITLE * 2);
    expect(Array.from(cleanTrackTitle("a".repeat(200))!)).toHaveLength(MAX_TRACK_TITLE);
  });
});
