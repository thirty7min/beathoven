import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, createUser, rpc, rpcError, submitVerified, verifiedUpload, type TestDb } from "./harness";

type JoinResult = { room_id: string; code: string; version: number; role: string };
type Player = { user_id: string; left_at: string | null; is_ready: boolean; role: string };
type State = {
  version: number;
  room: { status: string; host_id: string | null; track_order: string[]; current_track: number | null; autostart_at: string | null };
  players: Player[];
  readiness: { ready: number; total: number; all_ready: boolean; can_start: boolean };
  current_votes: { count: number; eligible: number } | null;
  skip: { votes: number; needed: number } | null;
  review: { done_user_ids: string[]; total: number } | null;
  chat: { body: string; kind: string }[];
};
type PublicRoom = { id: string; player_count: number; spectator_count: number; joinable: boolean };

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});

const users = (n: number) => Promise.all(Array.from({ length: n }, () => createUser(db)));
const snapshot = (userId: string, roomId: string) => rpc<State>(db, userId, "get_room_snapshot", { p_room_id: roomId });
const join = (userId: string, code: string) => rpc<JoinResult>(db, userId, "join_room", { p_code: code });
const roleOf = (s: State, userId: string) => s.players.find((p) => p.user_id === userId && p.left_at === null)?.role ?? null;
const expirePhase = (roomId: string) =>
  db.query("update public.rooms set phase_ends_at = now() - interval '2 seconds' where id = $1", [roomId]);
const idleFor = (roomId: string, userId: string, seconds: number) =>
  db.query("update public.room_players set last_seen_at = now() - make_interval(secs => $3) where room_id = $1 and user_id = $2", [
    roomId,
    userId,
    seconds,
  ]);
const ownerOf = async (submissionId: string) =>
  (await db.query<{ user_id: string }>("select user_id from public.submissions where id = $1", [submissionId])).rows[0].user_id;

async function lobby(n: number, settings: Record<string, unknown> = {}) {
  const players = await users(n);
  const room = await rpc<{ room_id: string; code: string }>(db, players[0], "create_room", { p_mode: "creative", ...settings });
  for (const p of players.slice(1)) await join(p, room.code);
  return { players, roomId: room.room_id, code: room.code };
}

async function producing(n: number, settings: Record<string, unknown> = {}) {
  const room = await lobby(n, settings);
  await rpc(db, room.players[0], "start_game", { p_room_id: room.roomId, p_force: true });
  return room;
}

async function watchers(code: string, n: number) {
  const ids = await users(n);
  for (const id of ids) expect((await join(id, code)).role).toBe("spectator");
  return ids;
}

async function listening(n: number, spectatorCount: number) {
  const room = await producing(n);
  const spectators = await watchers(room.code, spectatorCount);
  for (const p of room.players) await submitVerified(db, p, room.roomId);
  await db.query("update public.rooms set track_started_at = now() - interval '1 second' where id = $1", [room.roomId]);
  return { ...room, spectators };
}

async function endTrack(roomId: string, by: string) {
  await db.query(
    "update public.rooms set track_started_at = now() - interval '1 hour', phase_ends_at = now() - interval '2 seconds' where id = $1",
    [roomId],
  );
  await rpc(db, by, "advance_room", { p_room_id: roomId });
}

async function backToLobby(roomId: string, by: string) {
  await expirePhase(roomId);
  await rpc(db, by, "advance_room", { p_room_id: roomId });
  expect((await snapshot(by, roomId)).room.status).toBe("results");
  await expirePhase(roomId);
  await rpc(db, by, "advance_room", { p_room_id: roomId });
  expect((await snapshot(by, roomId)).room.status).toBe("lobby");
}

describe("joining as a spectator", () => {
  it("watches a game in progress, live, without joining the game", async () => {
    const { players, roomId, code } = await producing(2);
    const [fan] = await users(1);
    const before = (await snapshot(players[0], roomId)).version;

    expect(await join(fan, code)).toMatchObject({ room_id: roomId, role: "spectator" });
    const s = await snapshot(fan, roomId);
    expect(s.version).toBe(before + 1);
    expect(roleOf(s, fan)).toBe("spectator");
    expect(roleOf(s, players[1])).toBe("player");
    expect(s.readiness.total).toBe(2);

    const { rows } = await db.query<{ payload: State }>(
      "select payload from realtime.messages where topic = $1 and event = 'room_state' order by id desc limit 1",
      [`room:${roomId}`],
    );
    expect(roleOf(rows[0].payload, fan)).toBe("spectator");
    expect(await rpc(db, fan, "room_heartbeat")).toMatchObject({ id: roomId, role: "spectator", player_count: 2 });
    expect((await join(fan, code)).role).toBe("spectator");
  });

  it("watches a full lobby and shows up in the public list", async () => {
    const { players, roomId, code } = await lobby(2, { p_max_players: 2 });
    const [fan] = await watchers(code, 1);
    const s = await snapshot(players[0], roomId);
    expect(roleOf(s, fan)).toBe("spectator");
    expect(s.readiness.total).toBe(2);
    const list = await rpc<PublicRoom[]>(db, fan, "list_public_rooms");
    expect(list.find((r) => r.id === roomId)).toMatchObject({ player_count: 2, spectator_count: 1, joinable: false });
  });

  it("never spectates through quick match", async () => {
    const { roomId } = await lobby(2, { p_max_players: 2 });
    const [seeker] = await users(1);
    const result = await rpc<JoinResult & { created: boolean }>(db, seeker, "quick_match", { p_mode: "creative" });
    expect(result.created).toBe(true);
    expect(result.room_id).not.toBe(roomId);
  });

  it("caps the number of spectators", async () => {
    const { roomId, code } = await producing(2);
    const crowd = await users(50);
    for (const id of crowd) {
      await db.query("insert into public.room_players (room_id, user_id, role) values ($1, $2, 'spectator')", [roomId, id]);
    }
    const [late] = await users(1);
    expect(await rpcError(db, late, "join_room", { p_code: code })).toBe("spectators_full");
  });
});

describe("spectator permissions", () => {
  it("rejects ready-up in the lobby but allows chat and leaving", async () => {
    const { players, roomId, code } = await lobby(2, { p_max_players: 2 });
    const [fan] = await watchers(code, 1);
    expect(await rpcError(db, fan, "set_ready", { p_room_id: roomId, p_ready: true })).toBe("spectating");
    expect(await rpcError(db, fan, "start_game", { p_room_id: roomId, p_force: true })).toBe("spectating");
    expect(await rpcError(db, fan, "update_room_settings", { p_room_id: roomId, p_name: "Mine" })).toBe("spectating");
    await rpc(db, fan, "send_chat", { p_room_id: roomId, p_body: "gl" });
    expect((await snapshot(players[0], roomId)).chat.map((m) => m.body)).toContain("gl");
    await rpc(db, fan, "leave_room", { p_room_id: roomId });
    expect(roleOf(await snapshot(players[0], roomId), fan)).toBeNull();
  });

  it("rejects uploads while producing", async () => {
    const { players, roomId, code } = await producing(2);
    const [fan] = await watchers(code, 1);
    expect(await rpcError(db, fan, "reserve_upload", { p_room_id: roomId, p_kind: "submission" })).toBe("spectating");
    const { uploadId } = await verifiedUpload(db, players[0], roomId);
    expect(await rpcError(db, fan, "submit_track", { p_room_id: roomId, p_upload_id: uploadId })).toBe("spectating");
    expect(await rpcError(db, fan, "confirm_submission", { p_room_id: roomId, p_clip_start_ms: 0, p_clip_end_ms: 30000 })).toBe(
      "spectating",
    );
    expect(await rpc(db, fan, "advance_room", { p_room_id: roomId })).toMatchObject({ advanced: false });
  });

  it("rejects votes, skips and kick votes while listening, and review while reviewing", async () => {
    const { players, roomId, spectators } = await listening(3, 1);
    const [fan] = spectators;
    const s = await snapshot(fan, roomId);
    const track = s.room.track_order[0];
    expect(await rpcError(db, fan, "cast_vote", { p_room_id: roomId, p_submission_id: track, p_score: 5 })).toBe("spectating");
    expect(await rpcError(db, fan, "skip_track", { p_room_id: roomId })).toBe("spectating");
    expect(await rpcError(db, fan, "vote_kick", { p_room_id: roomId, p_target: players[1] })).toBe("spectating");
    expect(await rpcError(db, fan, "kick_player", { p_room_id: roomId, p_user_id: players[1] })).toBe("spectating");

    for (let i = 0; i < 3; i++) await endTrack(roomId, players[0]);
    expect((await snapshot(fan, roomId)).room.status).toBe("reviewing");
    expect(await rpcError(db, fan, "finish_review", { p_room_id: roomId })).toBe("spectating");
    expect(await rpcError(db, fan, "cast_vote", { p_room_id: roomId, p_submission_id: track, p_score: 5 })).toBe("spectating");
    const { rows } = await db.query("select 1 from public.votes where voter_id = $1", [fan]);
    expect(rows).toHaveLength(0);
  });
});

describe("thresholds ignore spectators", () => {
  it("moves on from producing once every player submitted", async () => {
    const { players, roomId, code } = await producing(2);
    await watchers(code, 2);
    for (const p of players) await submitVerified(db, p, roomId);
    expect((await snapshot(players[0], roomId)).room.status).toBe("listening");
  });

  it("counts only players for ratings, skips and defaults", async () => {
    const { players, roomId } = await listening(2, 3);
    const s = await snapshot(players[0], roomId);
    expect(s.current_votes).toMatchObject({ eligible: 1 });
    expect(s.skip).toMatchObject({ needed: 2 });
    await endTrack(roomId, players[0]);
    const track = s.room.track_order[0];
    const { rows } = await db.query<{ voter_id: string }>("select voter_id from public.votes where submission_id = $1", [track]);
    const owner = await ownerOf(track);
    expect(rows.map((r) => r.voter_id)).toEqual(players.filter((p) => p !== owner));
  });

  it("finishes review once every player is done", async () => {
    const { players, roomId } = await listening(2, 2);
    for (let i = 0; i < 2; i++) await endTrack(roomId, players[0]);
    expect((await snapshot(players[0], roomId)).review).toMatchObject({ total: 2 });
    await rpc(db, players[0], "finish_review", { p_room_id: roomId });
    await rpc(db, players[1], "finish_review", { p_room_id: roomId });
    expect((await snapshot(players[0], roomId)).room.status).toBe("results");
  });

  it("counts only players toward kick votes", async () => {
    const { players, roomId, code } = await lobby(3, { p_max_players: 3 });
    await watchers(code, 3);
    expect(await rpc(db, players[1], "vote_kick", { p_room_id: roomId, p_target: players[2] })).toEqual({
      kicked: false,
      votes: 1,
      needed: 2,
    });
  });

  it("autostarts on the players' ready without restarting for new spectators", async () => {
    const { players, roomId, code } = await lobby(2, { p_max_players: 2 });
    for (const p of players) await rpc(db, p, "set_ready", { p_room_id: roomId, p_ready: true });
    await db.query("update public.rooms set autostart_at = now() + interval '1 second' where id = $1", [roomId]);
    const at = (await snapshot(players[0], roomId)).room.autostart_at;
    await watchers(code, 1);
    const s = await snapshot(players[0], roomId);
    expect(s.room.autostart_at).toBe(at);
    expect(s.readiness).toEqual({ ready: 2, total: 2, all_ready: true, can_start: true });
  });
});

describe("host kick", () => {
  it("removes and bans a spectator, host only", async () => {
    const { players, roomId, code } = await producing(3);
    const [fan, other] = await watchers(code, 2);
    expect(await rpcError(db, players[1], "kick_player", { p_room_id: roomId, p_user_id: fan })).toBe("not_host");
    expect(await rpcError(db, other, "kick_player", { p_room_id: roomId, p_user_id: fan })).toBe("spectating");
    expect(await rpcError(db, players[1], "vote_kick", { p_room_id: roomId, p_target: fan })).toBe("not_a_player");
    const before = (await snapshot(players[0], roomId)).version;

    await rpc(db, players[0], "kick_player", { p_room_id: roomId, p_user_id: fan });
    const s = await snapshot(players[0], roomId);
    expect(s.version).toBe(before + 1);
    expect(s.players.some((p) => p.user_id === fan)).toBe(false);
    expect(s.chat.filter((m) => m.kind === "system").at(-1)!.body).toMatch(/was kicked by the host$/);
    expect(s.room.status).toBe("producing");

    expect(await rpcError(db, fan, "join_room", { p_code: code })).toBe("banned_from_room");
    expect(await rpcError(db, fan, "get_room_snapshot", { p_room_id: roomId })).toBe("banned_from_room");
    expect(await rpc(db, fan, "room_heartbeat")).toBeNull();
  });
});

describe("becoming a player", () => {
  it("promotes spectators in join order up to capacity when the room returns to the lobby", async () => {
    const { players, roomId, code } = await producing(2, { p_max_players: 3 });
    const [first, second, third] = await watchers(code, 3);
    await rpc(db, players[1], "room_heartbeat");
    await backToLobby(roomId, players[0]);

    let s = await snapshot(players[0], roomId);
    expect(roleOf(s, first)).toBe("player");
    expect(roleOf(s, second)).toBe("spectator");
    expect(roleOf(s, third)).toBe("spectator");
    expect(s.readiness.total).toBe(3);

    await rpc(db, players[1], "leave_room", { p_room_id: roomId });
    s = await snapshot(players[0], roomId);
    expect(roleOf(s, second)).toBe("player");
    expect(roleOf(s, third)).toBe("spectator");

    await rpc(db, players[0], "update_room_settings", { p_room_id: roomId, p_max_players: 4 });
    expect(roleOf(await snapshot(players[0], roomId), third)).toBe("player");
    await rpc(db, second, "set_ready", { p_room_id: roomId, p_ready: true });
    expect((await snapshot(players[0], roomId)).players.find((p) => p.user_id === second)!.is_ready).toBe(true);
  });

  it("never hands the host to a spectator and closes when the last player leaves", async () => {
    const { players, roomId, code } = await producing(2);
    const [fan] = await watchers(code, 1);
    await rpc(db, players[0], "leave_room", { p_room_id: roomId });
    expect((await snapshot(players[1], roomId)).room.host_id).toBe(players[1]);
    await rpc(db, players[1], "leave_room", { p_room_id: roomId });
    const s = await snapshot(fan, roomId);
    expect(s.room.status).toBe("closed");
    expect(await rpc(db, fan, "room_heartbeat")).toBeNull();
  });
});

describe("member list", () => {
  it("keeps a producer who left again as a spectator, and drops spectators with no entry", async () => {
    const { players, roomId, code } = await producing(3);
    const [fan] = await watchers(code, 1);
    await submitVerified(db, players[2], roomId);
    await rpc(db, players[2], "leave_room", { p_room_id: roomId });
    await expirePhase(roomId);
    await rpc(db, players[0], "advance_room", { p_room_id: roomId });
    expect((await join(players[2], code)).role).toBe("spectator");
    await rpc(db, players[2], "leave_room", { p_room_id: roomId });
    await rpc(db, fan, "leave_room", { p_room_id: roomId });
    const s = await snapshot(players[0], roomId);
    expect(s.players.find((p) => p.user_id === players[2])).toMatchObject({ role: "spectator" });
    expect(s.players.find((p) => p.user_id === players[2])!.left_at).not.toBeNull();
    expect(s.players.some((p) => p.user_id === fan)).toBe(false);
  });
});

describe("idle spectators", () => {
  it("are removed after the grace in any phase while idle players stay mid-game", async () => {
    const { players, roomId, code } = await producing(2);
    const [fan, keen] = await watchers(code, 2);
    await idleFor(roomId, fan, 91);
    await idleFor(roomId, keen, 85);
    await idleFor(roomId, players[1], 600);
    await db.query("select public.sweep_rooms()");
    const s = await snapshot(players[0], roomId);
    expect(roleOf(s, fan)).toBeNull();
    expect(roleOf(s, keen)).toBe("spectator");
    expect(roleOf(s, players[1])).toBe("player");
    expect(await rpc(db, fan, "room_heartbeat")).toBeNull();
  });
});
