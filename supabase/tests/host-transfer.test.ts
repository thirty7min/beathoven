import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, createUser, rpc, rpcError, type TestDb } from "./harness";

type State = {
  version: number;
  room: { status: string; host_id: string };
  players: { user_id: string; left_at: string | null; role: string }[];
  chat: { body: string; kind: string }[];
};

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});

const users = (n: number) => Promise.all(Array.from({ length: n }, () => createUser(db)));
const snapshot = (userId: string, roomId: string) => rpc<State>(db, userId, "get_room_snapshot", { p_room_id: roomId });
const join = (userId: string, code: string) => rpc<{ role: string }>(db, userId, "join_room", { p_code: code });
const transfer = (by: string, roomId: string, to: string) => rpc(db, by, "transfer_host", { p_room_id: roomId, p_user_id: to });
const transferError = (by: string | null, roomId: string, to: string) =>
  rpcError(db, by, "transfer_host", { p_room_id: roomId, p_user_id: to });
const order = async (roomId: string, viewer: string) =>
  (await snapshot(viewer, roomId)).players.filter((p) => p.left_at === null).map((p) => p.user_id);

async function lobby(n: number, settings: Record<string, unknown> = {}) {
  const players = await users(n);
  const room = await rpc<{ room_id: string; code: string }>(db, players[0], "create_room", { p_mode: "creative", ...settings });
  for (const p of players.slice(1)) await join(p, room.code);
  return { players, roomId: room.room_id, code: room.code };
}

async function seatBot(code: string) {
  const bot = await createUser(db);
  await db.query("update public.profiles set is_bot = true where id = $1", [bot]);
  await join(bot, code);
  return bot;
}

describe("transfer_host", () => {
  it("moves the new host to the top and the previous host second, keeping everyone else in order", async () => {
    const { players, roomId } = await lobby(4);
    const [a, b, c, d] = players;
    const before = (await snapshot(a, roomId)).version;
    await transfer(a, roomId, c);
    const s = await snapshot(b, roomId);
    expect(s.room.host_id).toBe(c);
    expect(s.version).toBeGreaterThan(before);
    expect(s.players.map((p) => p.user_id)).toEqual([c, a, b, d]);
    expect(s.chat.at(-1)).toMatchObject({ kind: "system", body: expect.stringMatching(/is now the host$/) });

    await transfer(c, roomId, d);
    expect(await order(roomId, a)).toEqual([d, c, a, b]);
  });

  it("is for the host, in the lobby, onto an active human player", async () => {
    const { players, roomId, code } = await lobby(3, { p_max_players: 3 });
    const [host, other, third] = players;
    const fan = await createUser(db);
    expect((await join(fan, code)).role).toBe("spectator");
    const outsider = await createUser(db);

    expect(await transferError(other, roomId, third)).toMatch("not_host");
    expect(await transferError(host, roomId, host)).toMatch("already_host");
    expect(await transferError(host, roomId, fan)).toMatch("host_must_be_player");
    expect(await transferError(host, roomId, outsider)).toMatch("not_in_room");
    expect(await transferError(outsider, roomId, other)).toMatch("not_member");
    expect(await transferError(fan, roomId, other)).toMatch("spectating");

    await rpc(db, third, "leave_room", { p_room_id: roomId });
    expect(await transferError(host, roomId, third)).toMatch("not_in_room");
    await db.query("update public.rooms set max_players = 5 where id = $1", [roomId]);
    const bot = await seatBot(code);
    expect(await transferError(host, roomId, bot)).toMatch("bot_cannot_host");

    await rpc(db, host, "start_game", { p_room_id: roomId, p_force: true });
    expect(await transferError(host, roomId, other)).toMatch("wrong_phase");
    expect((await snapshot(host, roomId)).room.host_id).toBe(host);
  });

  it("rejects anonymous callers", async () => {
    const { players, roomId } = await lobby(2);
    expect(await transferError(null, roomId, players[1])).toMatch("not_authenticated");
  });
});

describe("member order", () => {
  it("puts a player who rejoins the lobby at the bottom", async () => {
    const { players, roomId, code } = await lobby(3);
    await rpc(db, players[1], "leave_room", { p_room_id: roomId });
    await join(players[1], code);
    expect(await order(roomId, players[0])).toEqual([players[0], players[2], players[1]]);
  });

  it("hands the host to the next human in order and lists them first when the host leaves", async () => {
    const { players, roomId, code } = await lobby(1);
    const bot = await seatBot(code);
    const [second, third] = await users(2);
    await join(second, code);
    await join(third, code);
    await rpc(db, players[0], "leave_room", { p_room_id: roomId });
    const s = await snapshot(second, roomId);
    expect(s.room.host_id).toBe(second);
    expect(await order(roomId, second)).toEqual([second, bot, third]);
  });

  it("follows a transfer when the new host later leaves", async () => {
    const { players, roomId } = await lobby(4);
    const [a, b, c, d] = players;
    await transfer(a, roomId, c);
    await rpc(db, c, "leave_room", { p_room_id: roomId });
    expect((await snapshot(a, roomId)).room.host_id).toBe(a);
    expect(await order(roomId, a)).toEqual([a, b, d]);
  });
});
