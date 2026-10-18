import { describe, expect, it } from "vitest";
import { activePlayers, hasSubmitted, memberBadge, readyCount, startCheck } from "./lobby";
import type { RoomPlayer, RoomSnapshot } from "./types";

const player = (user_id: string, over: Partial<RoomPlayer> = {}): RoomPlayer => ({
  user_id,
  username: user_id,
  avatar_url: null,
  joined_at: "",
  left_at: null,
  is_ready: false,
  ...over,
});

function snap(over: Partial<RoomSnapshot> = {}, room: Partial<RoomSnapshot["room"]> = {}): RoomSnapshot {
  return {
    version: 1,
    server_time: "",
    me: "host",
    my_votes: [],
    chat: [],
    players: [player("host"), player("b")],
    assets: [],
    submissions: [],
    votes_cast: [],
    results: [],
    room: {
      id: "r",
      code: "ABCDEF",
      host_id: "host",
      mode: "creative",
      max_players: 8,
      produce_seconds: 60,
      vote_seconds: 20,
      is_private: false,
      status: "lobby",
      round: 0,
      phase_started_at: "",
      phase_ends_at: null,
      track_order: [],
      current_track: null,
      track_started_at: null,
      ...room,
    },
    ...over,
  };
}

describe("startCheck", () => {
  it("blocks non-hosts, wrong phase, offline and lonely hosts", () => {
    expect(startCheck(snap({ me: "b" }), true).kind).toBe("blocked");
    expect(startCheck(snap({}, { status: "producing" }), true).kind).toBe("blocked");
    expect(startCheck(snap(), false)).toEqual({ kind: "blocked", reason: "Reconnecting to the room…" });
    expect(startCheck(snap({ players: [player("host"), player("b", { left_at: "x" })] }), true)).toEqual({
      kind: "blocked",
      reason: "Need at least 2 players to start.",
    });
  });

  it("offers a force start while anyone, the host included, isn't ready", () => {
    expect(startCheck(snap({ players: [player("host"), player("b"), player("c", { is_ready: true })] }), true)).toEqual({
      kind: "force",
      ready: 1,
      total: 3,
    });
    expect(startCheck(snap({ players: [player("host"), player("b", { is_ready: true })] }), true)).toEqual({
      kind: "force",
      ready: 1,
      total: 2,
    });
  });

  it("is ready once every active player, the host included, is ready", () => {
    const players = [player("host", { is_ready: true }), player("b", { is_ready: true }), player("gone", { left_at: "x" })];
    expect(startCheck(snap({ players }), true)).toEqual({ kind: "ready" });
  });

  it("never waits on or counts spectators", () => {
    const players = [player("host", { is_ready: true }), player("b", { is_ready: true }), player("fan", { role: "spectator" })];
    expect(startCheck(snap({ players }), true)).toEqual({ kind: "ready" });
    expect(startCheck(snap({ players: [player("host"), player("fan", { role: "spectator" })] }), true).kind).toBe("blocked");
  });
});

describe("readyCount", () => {
  it("counts active players only, the host by their own toggle", () => {
    const players = [player("a", { is_ready: true }), player("b"), player("c", { is_ready: true, left_at: "x" }), player("host")];
    expect(readyCount(players)).toEqual({ ready: 1, total: 3 });
    expect(readyCount([...players.slice(0, 3), player("host", { is_ready: true })])).toEqual({ ready: 2, total: 3 });
    expect(readyCount([...players, player("fan", { role: "spectator" })])).toEqual({ ready: 1, total: 3 });
  });
});

describe("activePlayers", () => {
  it("leaves out spectators and anyone who left", () => {
    const players = [player("a"), player("fan", { role: "spectator" }), player("gone", { left_at: "x" }), player("b", { role: "player" })];
    expect(activePlayers(players).map((p) => p.user_id)).toEqual(["a", "b"]);
  });
});

describe("hasSubmitted", () => {
  const track = { id: "t1", user_id: "b", storage_path: "", duration_ms: 1000, submitted_at: "" };

  it("reads the round's submitters while producing and after", () => {
    const producing = snap({ submitted_user_ids: ["b"] }, { status: "producing" });
    expect(hasSubmitted(producing, "b")).toBe(true);
    expect(hasSubmitted(producing, "host")).toBe(false);
    expect(hasSubmitted(snap({ submitted_user_ids: ["b"] }, { status: "listening" }), "b")).toBe(true);
    expect(hasSubmitted(snap({ submitted_user_ids: ["b"] }, { status: "results" }), "b")).toBe(true);
  });

  it("falls back to the visible tracks and to your own submission", () => {
    expect(hasSubmitted(snap({ submissions: [track] }, { status: "producing" }), "b")).toBe(true);
    const mine = snap({ submitted_user_ids: [], my_submission: { ...track, id: "t2", user_id: "host", confirmed: true, clip_start_ms: 0, clip_end_ms: 1000 } }, { status: "producing" });
    expect(hasSubmitted(mine, "host")).toBe(true);
    expect(hasSubmitted(mine, "b")).toBe(false);
  });

  it("only rings your own track once you confirm it", () => {
    const draft = { ...track, id: "t2", user_id: "host", confirmed: false, clip_start_ms: 0, clip_end_ms: 1000 };
    expect(hasSubmitted(snap({ submitted_user_ids: [], my_submission: draft }, { status: "producing" }), "host")).toBe(false);
    expect(hasSubmitted(snap({ submitted_user_ids: ["host"], my_submission: draft }, { status: "producing" }), "host")).toBe(false);
  });

  it("never rings in the lobby, even with last game's submitters", () => {
    expect(hasSubmitted(snap({ submitted_user_ids: ["b"] }), "b")).toBe(false);
    expect(hasSubmitted(snap({ submitted_user_ids: ["b"] }, { status: "closed" }), "b")).toBe(false);
  });
});

describe("memberBadge", () => {
  it("marks every ready lobby member for everyone, bots and the host included", () => {
    const players = [player("host", { is_ready: true }), player("b"), player("bot", { is_ready: true, is_bot: true })];
    for (const me of ["host", "b"]) {
      const s = snap({ me, players });
      expect(memberBadge(s, "host", null)).toBe("ready");
      expect(memberBadge(s, "b", null)).toBeNull();
      expect(memberBadge(s, "bot", null)).toBe("ready");
    }
  });

  it("drops the host's badge when they unready", () => {
    expect(memberBadge(snap({ players: [player("host"), player("b")] }), "host", null)).toBeNull();
  });

  it("puts playing first and shows no status text in game", () => {
    const players = [player("host", { is_ready: true }), player("b", { is_ready: true })];
    expect(memberBadge(snap({ players }), "b", "b")).toBe("playing");
    expect(memberBadge(snap({ players }, { status: "results" }), "b", null)).toBeNull();
    expect(memberBadge(snap({ players, submitted_user_ids: ["b"] }, { status: "producing" }), "b", null)).toBeNull();
  });
});
