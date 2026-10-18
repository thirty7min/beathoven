import { describe, expect, it } from "vitest";
import { playerPhaseStatus, readyCount, startCheck } from "./lobby";
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

  it("offers a force start while others aren't ready", () => {
    expect(startCheck(snap({ players: [player("host"), player("b"), player("c", { is_ready: true })] }), true)).toEqual({
      kind: "force",
      waitingFor: 1,
    });
  });

  it("is ready once every other active player is ready", () => {
    const players = [player("host"), player("b", { is_ready: true }), player("gone", { left_at: "x" })];
    expect(startCheck(snap({ players }), true)).toEqual({ kind: "ready" });
  });
});

describe("readyCount", () => {
  it("counts active players only, with the host implicitly ready", () => {
    const players = [player("a", { is_ready: true }), player("b"), player("c", { is_ready: true, left_at: "x" }), player("host")];
    expect(readyCount(players, null)).toEqual({ ready: 1, total: 3 });
    expect(readyCount(players, "host")).toEqual({ ready: 2, total: 3 });
  });
});

describe("playerPhaseStatus", () => {
  const track = { id: "t1", user_id: "b", storage_path: "", duration_ms: 1000, submitted_at: "" };

  it("shows ready in the lobby and submissions while producing", () => {
    const s = snap({ players: [player("host"), player("b")] });
    expect(playerPhaseStatus(s, "host")).toBe("ready");
    expect(playerPhaseStatus(s, "b")).toBe("waiting");
    const producing = snap({ submissions: [track] }, { status: "producing" });
    expect(playerPhaseStatus(producing, "b")).toBe("done");
    expect(playerPhaseStatus(producing, "host")).toBe("waiting");
  });

  it("uses submitted_user_ids while producing, when the track list is hidden", () => {
    const producing = snap({ submitted_user_ids: ["host"] }, { status: "producing" });
    expect(playerPhaseStatus(producing, "host")).toBe("done");
    expect(playerPhaseStatus(producing, "b")).toBe("waiting");
  });

  it("shows votes on the current track in reveal rooms and hides the author", () => {
    const s = snap(
      { submissions: [track], current_votes: { submission_id: "t1", count: 1, eligible: 1, voted_user_ids: ["host"] } },
      { status: "listening", track_order: ["t1"], current_track: 0, reveal_names: true },
    );
    expect(playerPhaseStatus(s, "host")).toBe("done");
    expect(playerPhaseStatus(s, "b")).toBeNull();
  });

  it("shows no per-player vote status in blind rooms", () => {
    const blind = { ...track, user_id: null };
    const s = snap(
      { submissions: [blind], current_votes: { submission_id: "t1", count: 1, eligible: 1 } },
      { status: "listening", track_order: ["t1"], current_track: 0, reveal_names: false },
    );
    expect(playerPhaseStatus(s, "host")).toBeNull();
    expect(playerPhaseStatus(s, "b")).toBeNull();
  });
});
