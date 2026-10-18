import { describe, expect, it } from "vitest";
import type { RoomSnapshot } from "@/lib/game/types";
import { reviewProgress, reviewRows, settledOverrides } from "./review";

const entry = (id: string, position: number, over: Record<string, unknown> = {}) => ({
  submission_id: id,
  position,
  duration_ms: 120_000,
  clip_start_ms: 10_000,
  clip_end_ms: 40_000,
  is_mine: false,
  my_vote: null as number | null,
  is_default: false,
  ...over,
});

const snapshot = (over: Partial<RoomSnapshot> = {}, reveal = false) =>
  ({
    me: "me",
    room: { reveal_names: reveal },
    submissions: [
      { id: "a", user_id: "u1", storage_path: "p/a", duration_ms: 120_000 },
      { id: "b", user_id: "me", storage_path: "p/b", duration_ms: 120_000 },
    ],
    my_review: [entry("a", 1, { my_vote: 4 }), entry("b", 2, { is_mine: true })],
    review: { done_user_ids: ["u1"], total: 3 },
    ...over,
  }) as unknown as RoomSnapshot;

describe("reviewRows", () => {
  it("labels by order and only names producers when names are revealed", () => {
    const rows = reviewRows(snapshot());
    expect(rows.map((r) => r.label)).toEqual(["Track 1", "Track 2"]);
    expect(rows[0]).toMatchObject({ producerId: null, storagePath: "p/a", clipStartMs: 10_000, clipMs: 30_000, score: 4, auto: false });
    expect(rows[1].mine).toBe(true);
    expect(reviewRows(snapshot({}, true))[0].producerId).toBe("u1");
  });

  it("marks defaulted or missing ratings as auto at the default score", () => {
    const rows = reviewRows(snapshot({ my_review: [entry("a", 1, { my_vote: 3, is_default: true }), entry("b", 2)] } as Partial<RoomSnapshot>));
    expect(rows.map((r) => [r.score, r.auto])).toEqual([
      [3, true],
      [3, true],
    ]);
  });

  it("always lists the viewer's own track last and keeps the rest in order", () => {
    const rows = reviewRows(
      snapshot({ my_review: [entry("a", 1, { is_mine: true }), entry("b", 2), entry("c", 3)] } as Partial<RoomSnapshot>),
    );
    expect(rows.map((r) => r.submissionId)).toEqual(["b", "c", "a"]);
  });

  it("shows a local change straight away", () => {
    expect(reviewRows(snapshot(), { a: 2 })[0]).toMatchObject({ score: 2, auto: false });
  });
});

describe("settledOverrides", () => {
  it("drops local changes once the snapshot has them", () => {
    expect(settledOverrides(snapshot(), { a: 4 })).toEqual({});
    const overrides = { a: 5 };
    expect(settledOverrides(snapshot(), overrides)).toBe(overrides);
  });
});

describe("reviewProgress", () => {
  it("counts who is done and whether you are", () => {
    expect(reviewProgress(snapshot())).toEqual({ done: 1, total: 3, meDone: false });
    expect(reviewProgress(snapshot({ review: { done_user_ids: ["u1", "me"], total: 3 } }))).toEqual({ done: 2, total: 3, meDone: true });
  });
});
