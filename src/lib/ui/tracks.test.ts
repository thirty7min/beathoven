import { describe, expect, it } from "vitest";
import type { MyTrack } from "@/lib/tracks/api";
import { STREAM_REFRESH_MARGIN_MS, canSplit, formatWinRate, mergeTargets, ordinal, streamUsable, suggestionViews, trackTimeLabel } from "./tracks";

const track = (id: string, extra: Partial<MyTrack> = {}): MyTrack => ({
  id,
  title: `Track ${id}`,
  title_edited: false,
  created_at: "2026-10-01T00:00:00Z",
  latest_submission_id: null,
  submissions: [],
  suggestions: [],
  ...extra,
});

const submission = (id: string) => ({
  id,
  submitted_at: "2026-10-02T00:00:00Z",
  duration_ms: 60_000,
  mode: "creative" as const,
  finished: true,
  match_source: null,
  match_score: null,
});

describe("track formatting", () => {
  it("shows win rate as a whole percentage", () => {
    expect(formatWinRate(0.4567)).toBe("46%");
    expect(formatWinRate("1.0000")).toBe("100%");
    expect(formatWinRate(null)).toBe("–");
  });

  it("writes finishing places as ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st"]);
    expect(ordinal(0)).toBe("–");
  });
});

describe("track tools", () => {
  it("flattens suggestions with both titles and the upload date", () => {
    const tracks = [
      track("a", { submissions: [submission("s1")], suggestions: [{ submission_id: "s1", track_id: "b", track_title: "Track b", score: 0.9 }] }),
      track("b"),
    ];
    expect(suggestionViews(tracks)).toEqual([
      { submissionId: "s1", submittedAt: "2026-10-02T00:00:00Z", fromTrackId: "a", fromTitle: "Track a", toTrackId: "b", toTitle: "Track b", score: 0.9 },
    ]);
  });

  it("never offers merging a track into itself", () => {
    expect(mergeTargets([track("a"), track("b")], "a").map((t) => t.id)).toEqual(["b"]);
  });

  it("only allows splitting when a track has more than one upload", () => {
    expect(canSplit(track("a", { submissions: [submission("s1")] }))).toBe(false);
    expect(canSplit(track("a", { submissions: [submission("s1"), submission("s2")] }))).toBe(true);
    expect(canSplit(undefined)).toBe(false);
  });
});

describe("streamUsable", () => {
  const now = Date.parse("2026-10-18T00:00:00Z");

  it("reuses a signed URL until it's close to expiring", () => {
    expect(streamUsable(new Date(now + STREAM_REFRESH_MARGIN_MS + 1000).toISOString(), now)).toBe(true);
    expect(streamUsable(new Date(now + STREAM_REFRESH_MARGIN_MS - 1000).toISOString(), now)).toBe(false);
  });

  it("refetches without a valid expiry", () => {
    expect(streamUsable(null, now)).toBe(false);
    expect(streamUsable("soon", now)).toBe(false);
  });
});

describe("trackTimeLabel", () => {
  it("shows the duration when idle and elapsed over duration when playing", () => {
    expect(trackTimeLabel(151_000, null)).toBe("2:31");
    expect(trackTimeLabel(151_000, 0)).toBe("0:00 / 2:31");
    expect(trackTimeLabel(151_000, 0.5)).toBe("1:15 / 2:31");
    expect(trackTimeLabel(151_000, 2)).toBe("2:31 / 2:31");
  });

  it("hides without a duration", () => {
    expect(trackTimeLabel(null, 0.3)).toBeNull();
    expect(trackTimeLabel(0, null)).toBeNull();
  });
});
