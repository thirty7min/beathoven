import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, createUser, rpc, type TestDb } from "./harness";

type Heartbeat = {
  id: string;
  code: string;
  name: string;
  mode: string;
  genre: string;
  status: string;
  max_players: number;
  player_count: number;
  host_username: string | null;
  host_display_name: string | null;
} | null;

type State = {
  room: { status: string; host_id: string };
  players: { user_id: string; left_at: string | null }[];
};

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});

const heartbeat = (userId: string) => rpc<Heartbeat>(db, userId, "room_heartbeat");
const snapshot = (userId: string, roomId: string) => rpc<State>(db, userId, "get_room_snapshot", { p_room_id: roomId });
const sweep = () => db.query("select public.sweep_rooms()");

const idleFor = (roomId: string, userId: string, seconds: number) =>
  db.query(`update public.room_players set last_seen_at = now() - make_interval(secs => $3) where room_id = $1 and user_id = $2`, [
    roomId,
    userId,
    seconds,
  ]);

const lastSeenAgoMs = async (roomId: string, userId: string) =>
  (
    await db.query<{ ms: number }>(
      "select extract(epoch from now() - last_seen_at)::float * 1000 as ms from public.room_players where room_id = $1 and user_id = $2",
      [roomId, userId],
    )
  ).rows[0].ms;

async function lobby(n = 2, settings: Record<string, unknown> = {}) {
  const players = await Promise.all(Array.from({ length: n }, () => createUser(db)));
  const room = await rpc<{ room_id: string; code: string }>(db, players[0], "create_room", { p_mode: "creative", ...settings });
  for (const p of players.slice(1)) await rpc(db, p, "join_room", { p_code: room.code });
  return { players, roomId: room.room_id, code: room.code };
}

describe("room_heartbeat", () => {
  it("returns null outside a room", async () => {
    expect(await heartbeat(await createUser(db))).toBeNull();
  });

  it("refreshes the active membership and returns the room summary", async () => {
    const { players, roomId, code } = await lobby(3, { p_name: "Late night", p_genre: "trap", p_max_players: 6 });
    await idleFor(roomId, players[1], 85);
    const beat = await heartbeat(players[1]);
    expect(beat).toMatchObject({
      id: roomId,
      code,
      name: "Late night",
      mode: "creative",
      genre: "trap",
      status: "lobby",
      max_players: 6,
      player_count: 3,
    });
    expect(await lastSeenAgoMs(roomId, players[1])).toBeLessThan(5000);
  });

  it("ignores rooms the caller left", async () => {
    const { players, roomId } = await lobby(2);
    await rpc(db, players[1], "leave_room", { p_room_id: roomId });
    expect(await heartbeat(players[1])).toBeNull();
  });

  it("keeps a lobby member through the sweep while they beat", async () => {
    const { players, roomId } = await lobby(2);
    await idleFor(roomId, players[1], 85);
    await heartbeat(players[1]);
    await idleFor(roomId, players[1], 85);
    await sweep();
    expect((await snapshot(players[0], roomId)).players.every((p) => p.left_at === null)).toBe(true);
  });
});

describe("lobby idle removal", () => {
  it("removes lobby members silent for over 90 seconds through the leave path", async () => {
    const { players, roomId } = await lobby(3);
    await idleFor(roomId, players[0], 91);
    await idleFor(roomId, players[2], 80);
    await sweep();
    const s = await snapshot(players[1], roomId);
    expect(s.room.host_id).toBe(players[1]);
    expect(s.players.find((p) => p.user_id === players[0])!.left_at).not.toBeNull();
    expect(s.players.find((p) => p.user_id === players[2])!.left_at).toBeNull();
    expect(await heartbeat(players[0])).toBeNull();
  });

  it("cancels the autostart when an idle member's removal leaves one player", async () => {
    const { players, roomId } = await lobby(2);
    for (const p of players) await rpc(db, p, "set_ready", { p_room_id: roomId, p_ready: true });
    const autostartAt = async () =>
      (await db.query<{ at: string | null }>("select autostart_at::text as at from public.rooms where id = $1", [roomId])).rows[0].at;
    expect(await autostartAt()).not.toBeNull();
    await idleFor(roomId, players[1], 91);
    await sweep();
    expect((await snapshot(players[0], roomId)).players.find((p) => p.user_id === players[1])!.left_at).not.toBeNull();
    expect(await autostartAt()).toBeNull();
  });

  it("leaves mid-game members in place", async () => {
    const { players, roomId } = await lobby(2);
    await rpc(db, players[0], "set_ready", { p_room_id: roomId, p_ready: true });
    await rpc(db, players[1], "set_ready", { p_room_id: roomId, p_ready: true });
    await rpc(db, players[0], "start_game", { p_room_id: roomId });
    await idleFor(roomId, players[1], 600);
    await sweep();
    const s = await snapshot(players[0], roomId);
    expect(s.room.status).toBe("producing");
    expect(s.players.every((p) => p.left_at === null)).toBe(true);
    expect(await heartbeat(players[1])).toMatchObject({ status: "producing" });
  });
});
