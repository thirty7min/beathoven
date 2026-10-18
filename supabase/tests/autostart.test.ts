import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, createUser, rpc, rpcError, type TestDb } from "./harness";

type State = {
  version: number;
  room: { status: string; round: number; autostart_at: string | null; host_id: string };
  readiness: { ready: number; total: number; all_ready: boolean; can_start: boolean };
};

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});

const snapshot = (userId: string, roomId: string) => rpc<State>(db, userId, "get_room_snapshot", { p_room_id: roomId });
const ready = (userId: string, roomId: string, value = true) => rpc(db, userId, "set_ready", { p_room_id: roomId, p_ready: value });

const autostartAt = async (roomId: string) =>
  (await db.query<{ at: string | null }>("select autostart_at::text as at from public.rooms where id = $1", [roomId])).rows[0].at;

const secondsLeft = async (roomId: string) =>
  (await db.query<{ s: number | null }>("select extract(epoch from autostart_at - now())::float as s from public.rooms where id = $1", [roomId]))
    .rows[0].s;

const expireCountdown = (roomId: string) =>
  db.query("update public.rooms set autostart_at = now() - interval '1 second' where id = $1", [roomId]);

const shortenCountdown = (roomId: string) =>
  db.query("update public.rooms set autostart_at = now() + interval '1 second' where id = $1", [roomId]);

async function lobby(n = 2, settings: Record<string, unknown> = {}) {
  const players = await Promise.all(Array.from({ length: n }, () => createUser(db)));
  const room = await rpc<{ room_id: string; code: string }>(db, players[0], "create_room", { p_mode: "creative", ...settings });
  for (const p of players.slice(1)) await rpc(db, p, "join_room", { p_code: room.code });
  return { players, roomId: room.room_id, code: room.code };
}

async function allReady(n = 2, settings: Record<string, unknown> = {}) {
  const l = await lobby(n, settings);
  for (const p of l.players) await ready(p, l.roomId);
  return l;
}

describe("auto-start countdown", () => {
  it("starts 5 seconds after everyone, the host included, is ready", async () => {
    const { players, roomId } = await lobby(3);
    await ready(players[1], roomId);
    await ready(players[2], roomId);
    expect(await autostartAt(roomId)).toBeNull();
    const before = (await snapshot(players[0], roomId)).version;
    await ready(players[0], roomId);
    const s = await snapshot(players[1], roomId);
    expect(s.room.autostart_at).not.toBeNull();
    expect(s.version).toBeGreaterThan(before);
    expect(s.readiness).toEqual({ ready: 3, total: 3, all_ready: true, can_start: true });
    expect(await secondsLeft(roomId)).toBeCloseTo(5, 0);
  });

  it("keeps the deadline when someone re-sends ready", async () => {
    const { players, roomId } = await allReady();
    await shortenCountdown(roomId);
    const at = await autostartAt(roomId);
    await ready(players[1], roomId);
    expect(await autostartAt(roomId)).toBe(at);
  });

  it("needs at least two players", async () => {
    const host = await createUser(db);
    const room = await rpc<{ room_id: string }>(db, host, "create_room", { p_mode: "creative" });
    await ready(host, room.room_id);
    expect(await autostartAt(room.room_id)).toBeNull();
  });

  it("cancels on unready and restarts a fresh 5 seconds once everyone is ready again", async () => {
    const { players, roomId } = await allReady();
    await ready(players[1], roomId, false);
    expect(await autostartAt(roomId)).toBeNull();
    expect((await snapshot(players[0], roomId)).room.autostart_at).toBeNull();
    await ready(players[1], roomId);
    await shortenCountdown(roomId);
    await ready(players[0], roomId, false);
    await ready(players[0], roomId);
    expect(await secondsLeft(roomId)).toBeCloseTo(5, 0);
  });

  it("cancels when someone joins", async () => {
    const { roomId, code } = await allReady();
    await rpc(db, await createUser(db), "join_room", { p_code: code });
    expect(await autostartAt(roomId)).toBeNull();
  });

  it("restarts when a ready player leaves and schedules when the last unready one does", async () => {
    const { players, roomId } = await allReady(3);
    await shortenCountdown(roomId);
    await rpc(db, players[2], "leave_room", { p_room_id: roomId });
    expect(await secondsLeft(roomId)).toBeCloseTo(5, 0);

    const other = await lobby(3);
    await ready(other.players[0], other.roomId);
    await ready(other.players[1], other.roomId);
    await rpc(db, other.players[2], "leave_room", { p_room_id: other.roomId });
    expect(await autostartAt(other.roomId)).not.toBeNull();
  });

  it("cancels when the leave drops below two players", async () => {
    const { players, roomId } = await allReady();
    await rpc(db, players[1], "leave_room", { p_room_id: roomId });
    expect(await autostartAt(roomId)).toBeNull();
  });

  it("follows kicks the same way", async () => {
    const { players, roomId } = await lobby(3);
    await ready(players[0], roomId);
    await ready(players[1], roomId);
    await rpc(db, players[0], "kick_player", { p_room_id: roomId, p_user_id: players[2] });
    expect(await autostartAt(roomId)).not.toBeNull();
    await rpc(db, players[0], "kick_player", { p_room_id: roomId, p_user_id: players[1] });
    expect(await autostartAt(roomId)).toBeNull();
  });

  it("cancels on rule changes and restarts on cosmetic ones", async () => {
    const { players, roomId } = await allReady();
    await shortenCountdown(roomId);
    await rpc(db, players[0], "update_room_settings", { p_room_id: roomId, p_name: "Late night" });
    expect(await secondsLeft(roomId)).toBeCloseTo(5, 0);
    await rpc(db, players[0], "update_room_settings", { p_room_id: roomId, p_produce_seconds: 600 });
    expect(await autostartAt(roomId)).toBeNull();
  });
});

describe("auto-start deadline", () => {
  it("does nothing before the deadline", async () => {
    const { players, roomId } = await allReady();
    expect(await rpc(db, players[1], "advance_room", { p_room_id: roomId })).toMatchObject({ advanced: false });
    expect((await snapshot(players[0], roomId)).room.status).toBe("lobby");
  });

  it("starts the game exactly once however many clients advance", async () => {
    const { players, roomId } = await allReady(3);
    await expireCountdown(roomId);
    const results = await Promise.all(players.map((p) => rpc<{ advanced: boolean }>(db, p, "advance_room", { p_room_id: roomId })));
    expect(results.filter((r) => r.advanced)).toHaveLength(1);
    expect(await rpc(db, players[0], "advance_room", { p_room_id: roomId })).toMatchObject({ advanced: false });

    const s = await snapshot(players[0], roomId);
    expect(s.room).toMatchObject({ status: "producing", round: 1, autostart_at: null });
    const assets = await db.query("select 1 from public.room_assets where room_id = $1", [roomId]);
    expect(assets.rows).toHaveLength(1);
    const { rows } = await db.query<{ is_ready: boolean }>("select is_ready from public.room_players where room_id = $1", [roomId]);
    expect(rows.every((r) => !r.is_ready)).toBe(true);
  });

  it("is picked up by the sweep", async () => {
    const { players, roomId } = await allReady();
    await expireCountdown(roomId);
    expect(await db.query<{ n: number }>("select public.sweep_rooms() as n").then((r) => r.rows[0].n)).toBe(1);
    expect((await snapshot(players[0], roomId)).room.status).toBe("producing");
    expect(await db.query<{ n: number }>("select public.sweep_rooms() as n").then((r) => r.rows[0].n)).toBe(0);
  });

  it("re-checks readiness at the deadline and cancels instead of starting", async () => {
    const { players, roomId } = await allReady();
    await expireCountdown(roomId);
    await db.query("update public.room_players set is_ready = false where user_id = $1", [players[1]]);
    expect(await rpc(db, players[0], "advance_room", { p_room_id: roomId })).toMatchObject({ advanced: true });
    const s = await snapshot(players[0], roomId);
    expect(s.room).toMatchObject({ status: "lobby", autostart_at: null });
  });

  it("works for a host alone with bots", async () => {
    await db.query("update public.app_config set dev_tools_enabled = true");
    const host = await createUser(db);
    const bot = await createUser(db);
    await db.transaction(async (tx) => {
      await tx.exec("set local role service_role");
      await tx.query("select public.dev_register_bot($1, 'bots/auto.wav', 40000)", [bot]);
    });
    const room = await rpc<{ room_id: string }>(db, host, "create_room", { p_mode: "creative" });
    await rpc(db, host, "dev_add_bot", { p_room_id: room.room_id });
    expect(await autostartAt(room.room_id)).toBeNull();
    expect((await snapshot(host, room.room_id)).readiness).toMatchObject({ ready: 1, total: 2, all_ready: false });
    await ready(host, room.room_id);
    expect(await autostartAt(room.room_id)).not.toBeNull();
    await expireCountdown(room.room_id);
    expect(await rpc(db, host, "advance_room", { p_room_id: room.room_id })).toMatchObject({ advanced: true });
    expect((await snapshot(host, room.room_id)).room.status).toBe("producing");
  });
});

describe("manual start", () => {
  it("needs the host ready unless forced", async () => {
    const { players, roomId } = await lobby(2);
    await ready(players[1], roomId);
    expect((await snapshot(players[0], roomId)).readiness).toEqual({ ready: 1, total: 2, all_ready: false, can_start: false });
    expect(await rpcError(db, players[0], "start_game", { p_room_id: roomId })).toBe("not_all_ready");
    await ready(players[0], roomId);
    await rpc(db, players[0], "start_game", { p_room_id: roomId });
    expect((await snapshot(players[0], roomId)).room).toMatchObject({ status: "producing", autostart_at: null });
  });

  it("still force starts with nobody ready", async () => {
    const { players, roomId } = await lobby(2);
    await rpc(db, players[0], "start_game", { p_room_id: roomId, p_force: true });
    expect((await snapshot(players[0], roomId)).room.status).toBe("producing");
  });
});
