import { describe, expect, it } from "vitest";
import { CHAT_HISTORY_LIMIT, initialRoomViewState, mergeChat, onlineUserIds, roomReducer } from "./room-store";
import type { ChatMessage, RoomSnapshot, RoomState } from "./types";

function state(version: number, overrides: Partial<RoomState["room"]> = {}): RoomState {
  return {
    version,
    room: {
      id: "r",
      code: "ABC234",
      host_id: "a",
      mode: "creative",
      max_players: 8,
      produce_seconds: 600,
      vote_seconds: 20,
      is_private: false,
      status: "lobby",
      round: 1,
      phase_started_at: "2026-10-18T12:00:00Z",
      phase_ends_at: null,
      track_order: [],
      current_track: null,
      track_started_at: null,
      ...overrides,
    },
    players: [],
    assets: [],
    submissions: [],
    votes_cast: [],
    results: [],
  };
}

const chat = (id: number): ChatMessage => ({
  id,
  room_id: "r",
  user_id: "a",
  username: "a",
  body: `m${id}`,
  created_at: "2026-10-18T12:00:00Z",
});

function snapshot(version: number, extra: Partial<RoomSnapshot> = {}, room: Partial<RoomState["room"]> = {}): RoomSnapshot {
  return { ...state(version, room), server_time: "2026-10-18T12:00:00Z", me: "a", my_votes: [], chat: [], ...extra };
}

const loaded = (s: RoomSnapshot) => roomReducer(initialRoomViewState, { type: "snapshot", snapshot: s });

describe("roomReducer", () => {
  it("applies newer room_state and ignores older or equal", () => {
    const view = loaded(snapshot(3));
    const newer = roomReducer(view, { type: "room_state", state: state(4, { status: "producing" }) });
    expect(newer.snapshot!.room.status).toBe("producing");
    expect(roomReducer(newer, { type: "room_state", state: state(4, { status: "lobby" }) })).toBe(newer);
    expect(roomReducer(newer, { type: "room_state", state: state(2) })).toBe(newer);
  });

  it("ignores room_state before the first snapshot", () => {
    expect(roomReducer(initialRoomViewState, { type: "room_state", state: state(9) })).toBe(initialRoomViewState);
  });

  it("keeps newer public state when an older snapshot lands late, but merges its chat and votes", () => {
    let view = loaded(snapshot(3));
    view = roomReducer(view, { type: "room_state", state: state(5, { status: "listening" }) });
    view = roomReducer(view, {
      type: "snapshot",
      snapshot: snapshot(4, { chat: [chat(1)], my_votes: [{ submission_id: "s1", score: 4 }] }, { status: "producing" }),
    });
    expect(view.snapshot!.version).toBe(5);
    expect(view.snapshot!.room.status).toBe("listening");
    expect(view.snapshot!.chat.map((m) => m.id)).toEqual([1]);
    expect(view.snapshot!.my_votes).toEqual([{ submission_id: "s1", score: 4 }]);
  });

  it("drops own votes when a new round starts", () => {
    let view = loaded(snapshot(3, { my_votes: [{ submission_id: "s1", score: 4 }] }));
    view = roomReducer(view, { type: "room_state", state: state(4, { round: 2, status: "producing" }) });
    expect(view.snapshot!.my_votes).toEqual([]);
  });

  it("records own votes and dedupes chat by id", () => {
    let view = loaded(snapshot(1, { chat: [chat(1), chat(2)] }));
    view = roomReducer(view, { type: "my_vote", vote: { submission_id: "s1", score: 5 } });
    view = roomReducer(view, { type: "chat", message: chat(2) });
    view = roomReducer(view, { type: "chat", message: chat(3) });
    view = roomReducer(view, { type: "chat", message: { ...chat(4), room_id: "other" } });
    expect(view.snapshot!.my_votes).toEqual([{ submission_id: "s1", score: 5 }]);
    expect(view.snapshot!.chat.map((m) => m.id)).toEqual([1, 2, 3]);
  });

  it("marks your own entry from my_submission across blind broadcasts", () => {
    const mine = { id: "s1", user_id: "a", storage_path: "r/1/x.wav", duration_ms: 1000, submitted_at: "2026-10-18T12:00:00Z" };
    const blind = { ...mine, user_id: null, submitted_at: null };
    const producing = loaded(snapshot(3, { my_submission: mine }, { status: "producing" }));
    expect(producing.snapshot!.submissions).toEqual([mine]);

    const listening = { ...state(4, { status: "listening", track_order: ["s2", "s1"], current_track: 0 }) };
    listening.submissions = [{ ...blind, id: "s2" }, blind];
    listening.readiness = { ready: 2, total: 2, all_ready: true, can_start: true };
    listening.current_votes = { submission_id: "s2", count: 1, eligible: 1 };
    const view = roomReducer(producing, { type: "room_state", state: listening });
    expect(view.snapshot!.submissions.map((s) => s.user_id)).toEqual([null, "a"]);
    expect(view.snapshot!.readiness?.all_ready).toBe(true);
    expect(view.snapshot!.current_votes?.count).toBe(1);
  });

  it("marks skip votes you cast and clears private state on a new round", () => {
    const skip = { submission_id: "s2", votes: 1, needed: 2 };
    const view = loaded(
      snapshot(3, { skip, my_submission: null }, { status: "listening", track_order: ["s2"], current_track: 0 }),
    );
    expect(view.snapshot!.skip?.you_voted).toBe(false);
    const voted = roomReducer(view, { type: "my_skip", submissionId: "s2" });
    expect(voted.snapshot!.skip?.you_voted).toBe(true);
    const next = roomReducer(voted, { type: "room_state", state: state(4, { round: 2 }) });
    expect(next.snapshot!.my_skip_votes).toEqual([]);
    expect(next.snapshot!.my_submission).toBeNull();
  });

  it("tracks connection status and presence", () => {
    let view = roomReducer(initialRoomViewState, { type: "connection", status: "error", error: "room_full" });
    expect(view).toMatchObject({ connection: "error", error: "room_full" });
    view = roomReducer(view, { type: "connection", status: "live" });
    expect(view.error).toBeNull();
    expect(roomReducer(view, { type: "presence", online: ["a"] }).online).toEqual(["a"]);
  });
});

describe("mergeChat", () => {
  it("orders by id and caps history", () => {
    const many = Array.from({ length: CHAT_HISTORY_LIMIT + 10 }, (_, i) => chat(i + 1));
    const merged = mergeChat([chat(5)], many.reverse());
    expect(merged).toHaveLength(CHAT_HISTORY_LIMIT);
    expect(merged[0].id).toBe(11);
    expect(merged.at(-1)!.id).toBe(CHAT_HISTORY_LIMIT + 10);
  });
});

describe("onlineUserIds", () => {
  it("dedupes users present in several tabs", () => {
    expect(
      onlineUserIds({
        k1: [{ user_id: "b", online_at: "" }],
        k2: [
          { user_id: "a", online_at: "" },
          { user_id: "b", online_at: "" },
        ],
      }),
    ).toEqual(["a", "b"]);
  });
});
