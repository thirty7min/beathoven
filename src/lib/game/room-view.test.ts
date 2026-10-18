import { describe, expect, it } from "vitest";
import { heroClock, phaseStat } from "./room-view";
import type { RoomSnapshot } from "./types";

const T0 = Date.parse("2026-01-01T00:00:00Z");
const iso = (ms: number) => new Date(T0 + ms).toISOString();

function snap(room: Partial<RoomSnapshot["room"]> = {}, over: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    version: 1,
    server_time: "",
    me: "a",
    my_votes: [],
    chat: [],
    players: [
      { user_id: "a", username: "a", avatar_url: null, joined_at: "", left_at: null, is_ready: true },
      { user_id: "b", username: "b", avatar_url: null, joined_at: "", left_at: null, is_ready: false },
    ],
    assets: [],
    submissions: [],
    votes_cast: [],
    results: [],
    room: {
      id: "r",
      code: "ABCDEF",
      host_id: "a",
      mode: "creative",
      max_players: 8,
      produce_seconds: 600,
      vote_seconds: 20,
      is_private: false,
      status: "lobby",
      round: 1,
      phase_started_at: iso(0),
      phase_ends_at: null,
      track_order: [],
      current_track: null,
      track_started_at: null,
      ...room,
    },
    ...over,
  };
}

describe("heroClock", () => {
  it("shows the configured produce time in the lobby", () => {
    expect(heroClock(snap(), T0)).toEqual({ label: "Produce time", remainingMs: null, idleMs: 600_000 });
  });

  it("counts down to the produce deadline, excluding the upload grace", () => {
    const producing = snap({ status: "producing", phase_ends_at: iso(615_000) });
    expect(heroClock(producing, T0 + 100_000)).toEqual({ label: "Time left to produce", remainingMs: 500_000 });
    expect(heroClock(producing, T0 + 605_000).remainingMs).toBe(0);
  });

  it("follows the listening sub-phases", () => {
    const track = { id: "t", user_id: "b", storage_path: "", duration_ms: 30_000, submitted_at: "" };
    const listening = snap(
      { status: "listening", track_order: ["t"], current_track: 0, track_started_at: iso(3000), phase_ends_at: iso(53_000) },
      { submissions: [track] },
    );
    expect(heroClock(listening, T0).label).toBe("Next track starts in");
    expect(heroClock(listening, T0 + 10_000)).toEqual({ label: "Track ends in", remainingMs: 23_000 });
    expect(heroClock(listening, T0 + 40_000)).toEqual({ label: "Track ends in", remainingMs: 0 });
  });
});

describe("phaseStat", () => {
  it("reports the per-phase completion count", () => {
    expect(phaseStat(snap())).toEqual({ label: "Ready", done: 1, total: 2 });
    const sub = { id: "s", user_id: "b", storage_path: "", duration_ms: 1000, submitted_at: "" };
    expect(phaseStat(snap({ status: "producing" }, { submissions: [sub] }))).toEqual({ label: "Submitted", done: 1, total: 2 });
    expect(
      phaseStat(snap({ status: "listening", track_order: ["s"], current_track: 0 }, { submissions: [sub], votes_cast: [{ submission_id: "s", voter_id: "a" }] })),
    ).toEqual({ label: "Rated", done: 1, total: 1 });
  });
});
