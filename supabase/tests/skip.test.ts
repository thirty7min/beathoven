import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, createUser, rpc, submitVerified, type TestDb } from "./harness";

type State = {
  room: { status: string; current_track: number | null; track_order: string[] };
  skip: { submission_id: string; votes: number; needed: number } | null;
};

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});

const snapshot = (userId: string, roomId: string) => rpc<State>(db, userId, "get_room_snapshot", { p_room_id: roomId });
const skip = (userId: string, roomId: string) =>
  rpc<{ skipped: boolean; votes: number; needed: number }>(db, userId, "skip_track", { p_room_id: roomId });

async function listeningRoom(n: number) {
  const players = await Promise.all(Array.from({ length: n }, () => createUser(db)));
  const room = await rpc<{ room_id: string; code: string }>(db, players[0], "create_room", { p_mode: "creative" });
  for (const p of players.slice(1)) await rpc(db, p, "join_room", { p_code: room.code });
  await db.query("update public.room_players set is_ready = true where room_id = $1", [room.room_id]);
  await rpc(db, players[0], "start_game", { p_room_id: room.room_id });
  for (const p of players) await submitVerified(db, p, room.room_id);
  return { players, roomId: room.room_id };
}

describe("majority skip", () => {
  it("lets the producer skip their own track", async () => {
    const { players, roomId } = await listeningRoom(3);
    const s = await snapshot(players[0], roomId);
    const { rows } = await db.query<{ user_id: string }>("select user_id from public.submissions where id = $1", [s.room.track_order[0]]);
    const owner = rows[0].user_id;
    expect(await skip(owner, roomId)).toEqual({ skipped: false, votes: 1, needed: 2 });
    expect(await skip(players.find((p) => p !== owner)!, roomId)).toMatchObject({ skipped: true });
    expect((await snapshot(owner, roomId)).room.current_track).toBe(1);
  });

  it("skips when a leave drops the threshold to the votes already cast", async () => {
    const { players, roomId } = await listeningRoom(4);
    await skip(players[0], roomId);
    await skip(players[1], roomId);
    expect((await snapshot(players[0], roomId)).skip).toMatchObject({ votes: 2, needed: 3 });
    await rpc(db, players[3], "leave_room", { p_room_id: roomId });
    const s = await snapshot(players[0], roomId);
    expect(s.room.current_track).toBe(1);
    expect(s.skip).toMatchObject({ votes: 0, needed: 2 });
  });

  it("stops counting a skipper who leaves", async () => {
    const { players, roomId } = await listeningRoom(4);
    await skip(players[3], roomId);
    await rpc(db, players[3], "leave_room", { p_room_id: roomId });
    expect((await snapshot(players[0], roomId)).skip).toMatchObject({ votes: 0, needed: 2 });
  });

  it("lets the sweep skip once idle members drop the threshold", async () => {
    const { players, roomId } = await listeningRoom(4);
    await skip(players[0], roomId);
    await skip(players[1], roomId);
    await db.query("update public.room_players set last_seen_at = now() - interval '2 minutes' where user_id = $1", [players[3]]);
    expect((await db.query<{ n: number }>("select public.sweep_rooms() as n")).rows[0].n).toBe(1);
    expect((await snapshot(players[0], roomId)).room.current_track).toBe(1);
    expect((await db.query<{ n: number }>("select public.sweep_rooms() as n")).rows[0].n).toBe(0);
  });

  it("does not count bots", async () => {
    await db.query("update public.app_config set dev_tools_enabled = true");
    const [host, guest] = [await createUser(db), await createUser(db)];
    const bots = [await createUser(db), await createUser(db)];
    for (const [i, bot] of bots.entries()) {
      await db.transaction(async (tx) => {
        await tx.exec("set local role service_role");
        await tx.query(`select public.dev_register_bot($1, 'bots/skip${i}.wav', 40000)`, [bot]);
      });
    }
    const room = await rpc<{ room_id: string; code: string }>(db, host, "create_room", { p_mode: "creative" });
    await rpc(db, guest, "join_room", { p_code: room.code });
    for (let i = 0; i < 2; i++) await rpc(db, host, "dev_add_bot", { p_room_id: room.room_id });
    await rpc(db, host, "start_game", { p_room_id: room.room_id, p_force: true });
    await submitVerified(db, host, room.room_id);
    await submitVerified(db, guest, room.room_id);
    const s = await snapshot(host, room.room_id);
    expect(s.room.status).toBe("listening");
    expect(s.skip!.needed).toBe(2);
    expect(await skip(host, room.room_id)).toMatchObject({ skipped: false, votes: 1, needed: 2 });
    expect(await skip(guest, room.room_id)).toMatchObject({ skipped: true });
  });
});
