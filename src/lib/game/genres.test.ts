import { describe, expect, it } from "vitest";
import { DEFAULT_GENRE, GENRES, genreLabel, isGenre } from "./genres";

describe("genres", () => {
  it("starts with all genres and has unique slugs", () => {
    expect(GENRES[0]).toEqual({ slug: DEFAULT_GENRE, label: "All genres" });
    expect(new Set(GENRES.map((g) => g.slug)).size).toBe(GENRES.length);
  });

  it("checks and labels slugs", () => {
    expect(isGenre("dnb")).toBe(true);
    expect(isGenre("jazz")).toBe(false);
    expect(genreLabel("dnb")).toBe("Drum & Bass");
    expect(genreLabel("rnb")).toBe("R&B");
    expect(genreLabel(undefined)).toBe("All genres");
  });
});
