import { beforeEach, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, rpc, rpcError, submitVerified, type TestDb } from "./harness";

type RoomRef = { room_id: string; code: string };
type Bot = { user_id: string; username: string };
type State = {
  room: { host_id: string | null; status: string; round: number; track_order: string[]; current_track: number | null };
  players: { user_id: string; left_at: string | null; is_ready: boolean; is_bot: boolean }[];
  readiness: { ready: number; total: number; all_ready: boolean };
  submitted_user_ids: string[];
  results: { user_id: string }[];
};

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});

const setGate = (on: boolean) => db.query("update public.app_config set dev_tools_enabled = $1", [on]);

const asService = <T>(sql: string, params: unknown[]) =>
  db.transaction(async (tx) => {
    await tx.exec("set local role service_role");
    return (await tx.query<T>(sql, params)).rows;
  });

async function registerBot(path = `bots/${crypto.randomUUID()}.wav`, durationMs = 24000) {
  const userId = await createUser(db);
  const [row] = await asService<{ bot: Bot }>("select public.dev_register_bot($1, $2, $3) as bot", [
    userId,
    path,
    durationMs,
  ]);
  return row.bot;
}

const snapshot = (userId: string, roomId: string) => rpc<State>(db, userId, "get_room_snapshot", { p_room_id: roomId });

async function lobby(humans = 1) {
  const players = await Promise.all(Array.from({ length: humans }, () => createUser(db)));
  const room = await rpc<RoomRef>(db, players[0], "create_room", { p_mode: "creative" });
  for (const p of players.slice(1)) await rpc(db, p, "join_room", { p_code: room.code });
  return { host: players[0], players, roomId: room.room_id };
}

const addBot = (host: string, roomId: string) => rpc<Bot>(db, host, "dev_add_bot", { p_room_id: roomId });

const submit = (userId: string, roomId: string) => submitVerified(db, userId, roomId, 30000);

async function expirePhase(roomId: string) {
  await db.query("update public.rooms set phase_ends_at = now() - interval '2 seconds' where id = $1", [roomId]);
  await db.query("select public.sweep_rooms()");
}

const votesOn = async (submissionId: string) =>
  (await db.query<{ voter_id: string; score: number }>(
    "select voter_id, score from public.votes where submission_id = $1",
    [submissionId],
  )).rows;

const ownerOf = async (submissionId: string) =>
  (await db.query<{ user_id: string }>("select user_id from public.submissions where id = $1", [submissionId])).rows[0]
    .user_id;

describe("dev tools gate", () => {
  it("is off by default and every bot RPC fails while it is", async () => {
    expect((await db.query<{ on: boolean }>("select dev_tools_enabled as on from public.app_config")).rows).toEqual([
      { on: false },
    ]);
    const { host, roomId } = await lobby();
    expect(await rpc(db, host, "dev_tools_enabled")).toBe(false);
    expect(await rpcError(db, host, "dev_add_bot", { p_room_id: roomId })).toMatch("dev_tools_disabled");
    expect(await rpcError(db, host, "dev_remove_bot", { p_room_id: roomId, p_bot_id: host })).toMatch(
      "dev_tools_disabled",
    );
    await expect(registerBot()).rejects.toThrow("dev_tools_disabled");
  });

  it("keeps app_config, dev_bots and is_bot out of clients' hands", async () => {
    const user = await createUser(db);
    for (const sql of [
      "select * from public.app_config",
      "update public.app_config set dev_tools_enabled = true",
      "select * from public.dev_bots",
      "update public.profiles set is_bot = true where id = auth.uid()",
    ]) {
      await expect(asUser(db, user, (tx) => tx.query(sql))).rejects.toThrow(/permission denied/);
    }
    await setGate(true);
    expect(await rpcError(db, user, "dev_register_bot", { p_user_id: user, p_storage_path: "bots/x.wav", p_duration_ms: 24000 })).toMatch(
      /permission denied/,
    );
  });

  it("stops bot behaviour when switched off", async () => {
    await setGate(true);
    await registerBot();
    const { host, roomId } = await lobby();
    const bot = await addBot(host, roomId);
    await setGate(false);
    await rpc(db, host, "start_game", { p_room_id: roomId, p_force: true });
    expect((await snapshot(host, roomId)).submitted_user_ids).not.toContain(bot.user_id);
  });
});

describe("bots", () => {
  beforeEach(async () => {
    await setGate(true);
  });

  it("registers numbered bots", async () => {
    const first = await registerBot();
    const second = await registerBot();
    expect([first.username, second.username]).toEqual(["Bot_1", "Bot_2"]);
    await expect(registerBot("../evil.wav")).rejects.toThrow("invalid_path");
  });

  it("lets only the host add bots, in the lobby, through the normal join", async () => {
    await registerBot();
    const { host, players, roomId } = await lobby(2);
    expect(await rpcError(db, players[1], "dev_add_bot", { p_room_id: roomId })).toMatch("not_host");
    const bot = await addBot(host, roomId);
    expect(await rpcError(db, host, "dev_add_bot", { p_room_id: roomId })).toMatch("no_idle_bot");

    const s = await snapshot(host, roomId);
    const seat = s.players.find((p) => p.user_id === bot.user_id)!;
    expect(seat).toMatchObject({ is_bot: true, is_ready: true, left_at: null });
    expect(s.players.find((p) => p.user_id === host)!.is_bot).toBe(false);
  });

  it("keeps the one-lobby rule: a seated bot is never reused", async () => {
    await registerBot();
    const a = await lobby();
    const b = await lobby();
    const bot = await addBot(a.host, a.roomId);
    expect(await rpcError(db, b.host, "dev_add_bot", { p_room_id: b.roomId })).toMatch("no_idle_bot");
    const other = await registerBot();
    expect((await addBot(b.host, b.roomId)).user_id).toBe(other.user_id);
    const seats = await db.query("select room_id from public.room_players where user_id = $1 and left_at is null", [
      bot.user_id,
    ]);
    expect(seats.rows).toEqual([{ room_id: a.roomId }]);
  });

  it("stays ready through settings changes that reset ready", async () => {
    await registerBot();
    const { host, roomId } = await lobby();
    const bot = await addBot(host, roomId);
    await rpc(db, host, "update_room_settings", { p_room_id: roomId, p_listen_seconds: 30 });
    const s = await snapshot(host, roomId);
    expect(s.players.find((p) => p.user_id === bot.user_id)!.is_ready).toBe(true);
    expect(s.readiness.all_ready).toBe(true);
    await rpc(db, host, "start_game", { p_room_id: roomId });
  });

  it("auto-submits when producing starts and auto-rates every other entry as it plays", async () => {
    await registerBot();
    await registerBot();
    const { host, roomId } = await lobby();
    const bots = [await addBot(host, roomId), await addBot(host, roomId)];
    await rpc(db, host, "start_game", { p_room_id: roomId });

    expect((await snapshot(host, roomId)).submitted_user_ids.sort()).toEqual(
      [...bots.map((b) => b.user_id)].sort(),
    );
    await submit(host, roomId);

    let s = await snapshot(host, roomId);
    expect(s.room.status).toBe("listening");
    for (let i = 0; i < s.room.track_order.length; i++) {
      const track = s.room.track_order[s.room.current_track!];
      const owner = await ownerOf(track);
      const votes = await votesOn(track);
      const expected = bots.map((b) => b.user_id).filter((id) => id !== owner);
      expect(votes.map((v) => v.voter_id).sort()).toEqual(expected.sort());
      for (const v of votes) expect([1, 2, 3, 4, 5]).toContain(v.score);
      await expirePhase(roomId);
      s = await snapshot(host, roomId);
    }
    expect(s.room.status).toBe("results");
    expect((await db.query("select * from public.track_skips")).rows).toEqual([]);
  });

  it("serves the placeholder through the normal storage read rule", async () => {
    const path = `bots/${crypto.randomUUID()}.wav`;
    await registerBot(path);
    const { host, players, roomId } = await lobby(2);
    await addBot(host, roomId);
    const canRead = (userId: string) =>
      asUser(db, userId, async (tx) =>
        (await tx.query<{ ok: boolean }>("select public.can_read_submission($1) as ok", [path])).rows[0].ok,
      );
    expect(await canRead(players[1])).toBe(false);
    await rpc(db, host, "start_game", { p_room_id: roomId, p_force: true });
    expect(await canRead(players[1])).toBe(false);
    await submit(host, roomId);
    await submit(players[1], roomId);
    expect((await snapshot(host, roomId)).room.status).toBe("listening");
    expect(await canRead(players[1])).toBe(true);
  });

  it("excludes bots from profile stats but keeps them in results", async () => {
    await registerBot();
    const { host, roomId } = await lobby();
    const bot = await addBot(host, roomId);
    await rpc(db, host, "start_game", { p_room_id: roomId });
    await submit(host, roomId);
    for (let i = 0; i < 2; i++) await expirePhase(roomId);
    const s = await snapshot(host, roomId);
    expect(s.room.status).toBe("results");
    expect(s.results.map((r) => r.user_id).sort()).toEqual([bot.user_id, host].sort());
    const stats = await db.query<{ id: string; games_played: number; wins: number; ties: number }>(
      "select id, games_played, wins, ties from public.profiles where id = any($1)",
      [[bot.user_id, host]],
    );
    expect(stats.rows.find((r) => r.id === bot.user_id)).toMatchObject({ games_played: 0, wins: 0, ties: 0 });
    expect(stats.rows.find((r) => r.id === host)!.games_played).toBe(1);
  });

  it("stays fresh while a human heartbeats, and goes stale once the gate is off", async () => {
    await registerBot();
    const { host, roomId } = await lobby();
    const bot = await addBot(host, roomId);
    await db.query("update public.room_players set last_seen_at = now() - interval '2 minutes' where room_id = $1", [
      roomId,
    ]);
    await rpc(db, host, "touch_room", { p_room_id: roomId });
    await db.query("select public.sweep_rooms()");
    expect((await snapshot(host, roomId)).players.find((p) => p.user_id === bot.user_id)!.left_at).toBeNull();

    await setGate(false);
    await db.query("update public.room_players set last_seen_at = now() - interval '2 minutes' where user_id = $1", [
      bot.user_id,
    ]);
    await rpc(db, host, "touch_room", { p_room_id: roomId });
    await db.query("select public.sweep_rooms()");
    expect((await snapshot(host, roomId)).players.find((p) => p.user_id === bot.user_id)!.left_at).not.toBeNull();
  });

  it("never hands host to a bot, and leaves with the last human", async () => {
    await registerBot();
    const { host, players, roomId } = await lobby(2);
    const bot = await addBot(host, roomId);
    await db.query("update public.room_players set joined_at = now() + interval '1 minute' where user_id = $1", [
      players[1],
    ]);
    await rpc(db, host, "leave_room", { p_room_id: roomId });
    expect((await snapshot(players[1], roomId)).room.host_id).toBe(players[1]);

    await rpc(db, players[1], "leave_room", { p_room_id: roomId });
    const s = await snapshot(players[1], roomId);
    expect(s.room.status).toBe("closed");
    expect(s.players.find((p) => p.user_id === bot.user_id)!.left_at).not.toBeNull();
    const again = await lobby();
    expect((await addBot(again.host, again.roomId)).user_id).toBe(bot.user_id);
  });

  it("lets the host remove a bot", async () => {
    await registerBot();
    const { host, players, roomId } = await lobby(2);
    const bot = await addBot(host, roomId);
    expect(await rpcError(db, players[1], "dev_remove_bot", { p_room_id: roomId, p_bot_id: bot.user_id })).toMatch(
      "not_host",
    );
    expect(await rpcError(db, host, "dev_remove_bot", { p_room_id: roomId, p_bot_id: players[1] })).toMatch(
      "not_a_bot",
    );
    await rpc(db, host, "dev_remove_bot", { p_room_id: roomId, p_bot_id: bot.user_id });
    expect((await snapshot(host, roomId)).players.find((p) => p.user_id === bot.user_id)!.left_at).not.toBeNull();
  });
});
