import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, createUser, rpc, rpcError, submitVerified, type TestDb } from "./harness";

type RoomRef = { room_id: string; code: string };
type KickResult = { kicked: boolean; votes: number; needed: number };
type State = {
  version: number;
  room: {
    host_id: string | null;
    status: string;
    track_order: string[];
    current_track: number | null;
    track_started_at: string | null;
  };
  players: { user_id: string; left_at: string | null }[];
  submitted_user_ids: string[];
  kick_votes: { target_user_id: string; votes: number; needed: number; expires_at: string }[];
  my_kick_votes: string[];
  chat: { body: string; kind: string; user_id: string | null }[];
};

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});

const users = (n: number) => Promise.all(Array.from({ length: n }, () => createUser(db)));
const snapshot = (userId: string, roomId: string) => rpc<State>(db, userId, "get_room_snapshot", { p_room_id: roomId });
const kick = (host: string, roomId: string, target: string) =>
  rpc(db, host, "kick_player", { p_room_id: roomId, p_user_id: target });
const voteKick = (voter: string, roomId: string, target: string) =>
  rpc<KickResult>(db, voter, "vote_kick", { p_room_id: roomId, p_target: target });

async function roomWith(n: number, settings: Record<string, unknown> = {}) {
  const players = await users(n);
  const room = await rpc<RoomRef>(db, players[0], "create_room", { p_mode: "creative", ...settings });
  for (const p of players.slice(1)) await rpc(db, p, "join_room", { p_code: room.code });
  return { players, roomId: room.room_id, code: room.code };
}

const submit = (userId: string, roomId: string) => submitVerified(db, userId, roomId, 30000);

const start = (host: string, roomId: string) => rpc(db, host, "start_game", { p_room_id: roomId, p_force: true });
const active = (s: State, userId: string) => s.players.some((p) => p.user_id === userId && p.left_at === null);
const systemLines = (s: State) => s.chat.filter((m) => m.kind === "system").map((m) => m.body);
const username = async (userId: string) =>
  (await db.query<{ username: string }>("select username from public.profiles where id = $1", [userId])).rows[0]
    .username;

describe("host kick", () => {
  it("is host-only, never self, and removes and bans the player", async () => {
    const { players, roomId, code } = await roomWith(3);
    const [host, b, c] = players;
    expect(await rpcError(db, b, "kick_player", { p_room_id: roomId, p_user_id: c })).toBe("not_host");
    expect(await rpcError(db, host, "kick_player", { p_room_id: roomId, p_user_id: host })).toBe("cannot_kick_self");
    const before = (await snapshot(host, roomId)).version;

    await kick(host, roomId, b);
    const s = await snapshot(host, roomId);
    expect(s.version).toBe(before + 1);
    expect(active(s, b)).toBe(false);
    expect(systemLines(s)).toEqual([`${await username(b)} was kicked by the host`]);
    expect(await rpcError(db, host, "kick_player", { p_room_id: roomId, p_user_id: b })).toBe("not_in_room");

    expect(await rpcError(db, b, "join_room", { p_code: code })).toBe("banned_from_room");
    expect(await rpcError(db, b, "get_room_snapshot", { p_room_id: roomId })).toBe("banned_from_room");
  });

  it("shows the removal in the broadcast and the system line in chat", async () => {
    const { players, roomId } = await roomWith(2);
    await kick(players[0], roomId, players[1]);
    const { rows } = await db.query<{ event: string; payload: State & { body?: string; kind?: string } }>(
      "select event, payload from realtime.messages where topic = $1 order by id",
      [`room:${roomId}`],
    );
    const state = rows.filter((r) => r.event === "room_state").at(-1)!.payload;
    expect(state.players.find((p) => p.user_id === players[1])!.left_at).not.toBeNull();
    const chat = rows.filter((r) => r.event === "chat").at(-1)!.payload;
    expect(chat).toMatchObject({ kind: "system", user_id: null });
  });

  it("keeps banned players out of quick match for that room", async () => {
    const { players, roomId } = await roomWith(2, { p_mode: "premade" });
    await kick(players[0], roomId, players[1]);
    const matched = await rpc<RoomRef & { created: boolean }>(db, players[1], "quick_match", { p_mode: "premade" });
    expect(matched.created).toBe(true);
    expect(matched.room_id).not.toBe(roomId);
  });

  it("doesn't count system lines against anyone's chat rate limit", async () => {
    const { players, roomId } = await roomWith(4);
    const [host, b, c, d] = players;
    await voteKick(b, roomId, d);
    await kick(host, roomId, c);
    for (let i = 0; i < 5; i++) await rpc(db, host, "send_chat", { p_room_id: roomId, p_body: `m${i}` });
    expect(systemLines(await snapshot(host, roomId))).toHaveLength(2);
  });
});

describe("vote kick", () => {
  it.each([
    [3, 2],
    [4, 2],
    [5, 3],
  ])("with %i players it takes %i votes", async (n, needed) => {
    const { players, roomId } = await roomWith(n);
    const target = players[n - 1];
    const voters = players.slice(0, n - 1);
    for (let i = 0; i < needed - 1; i++) {
      expect(await voteKick(voters[i], roomId, target)).toEqual({ kicked: false, votes: i + 1, needed });
    }
    expect(await voteKick(voters[needed - 1], roomId, target)).toMatchObject({ kicked: true, needed });
    const s = await snapshot(players[0], roomId);
    expect(active(s, target)).toBe(false);
    expect(s.kick_votes).toEqual([]);
    expect(systemLines(s).at(-1)).toBe(`${await username(target)} was vote-kicked`);
    expect(await rpcError(db, target, "get_room_snapshot", { p_room_id: roomId })).toBe("banned_from_room");
  });

  it("needs at least three humans", async () => {
    const { players, roomId } = await roomWith(2);
    expect(await rpcError(db, players[0], "vote_kick", { p_room_id: roomId, p_target: players[1] })).toBe(
      "not_enough_players_to_vote_kick",
    );
  });

  it("is idempotent, never self, and exposes counts without voter ids", async () => {
    const { players, roomId } = await roomWith(5);
    const [a, b, , , target] = players;
    expect(await rpcError(db, target, "vote_kick", { p_room_id: roomId, p_target: target })).toBe("cannot_kick_self");
    await voteKick(a, roomId, target);
    const version = (await snapshot(a, roomId)).version;
    expect(await voteKick(a, roomId, target)).toEqual({ kicked: false, votes: 1, needed: 3 });
    const s = await snapshot(a, roomId);
    expect(s.version).toBe(version);
    expect(s.kick_votes).toEqual([{ target_user_id: target, votes: 1, needed: 3, expires_at: expect.any(String) }]);
    expect(s.my_kick_votes).toEqual([target]);
    expect((await snapshot(b, roomId)).my_kick_votes).toEqual([]);
    expect(systemLines(s)).toEqual([`Vote to kick ${await username(target)} started (1/3)`]);
    const broadcast = (
      await db.query<{ payload: Record<string, unknown> }>(
        "select payload from realtime.messages where topic = $1 and event = 'room_state' order by id desc limit 1",
        [`room:${roomId}`],
      )
    ).rows[0].payload;
    expect(JSON.stringify(broadcast.kick_votes)).not.toContain(a);
    expect(broadcast).not.toHaveProperty("my_kick_votes");
  });

  it("expires two minutes after the first vote, and when the target leaves", async () => {
    const { players, roomId, code } = await roomWith(4);
    const [a, b, c, target] = players;
    await voteKick(a, roomId, target);
    await db.query("update public.kick_votes set created_at = now() - interval '3 minutes'");
    let s = await snapshot(a, roomId);
    expect(s.kick_votes).toEqual([]);
    expect(s.my_kick_votes).toEqual([]);
    expect(await voteKick(b, roomId, target)).toEqual({ kicked: false, votes: 1, needed: 2 });

    await rpc(db, target, "leave_room", { p_room_id: roomId });
    await rpc(db, target, "join_room", { p_code: code });
    s = await snapshot(a, roomId);
    expect(s.kick_votes).toEqual([]);
    expect(await voteKick(c, roomId, target)).toEqual({ kicked: false, votes: 1, needed: 2 });
  });

  it("can remove the host, handing host to the next player", async () => {
    const { players, roomId } = await roomWith(3);
    const [host, b, c] = players;
    await voteKick(b, roomId, host);
    expect((await voteKick(c, roomId, host)).kicked).toBe(true);
    expect((await snapshot(b, roomId)).room.host_id).toBe(b);
  });

  it("only counts votes from players still eligible", async () => {
    const { players, roomId } = await roomWith(5);
    const [a, b, c, , target] = players;
    await voteKick(a, roomId, target);
    await voteKick(b, roomId, target);
    await rpc(db, a, "leave_room", { p_room_id: roomId });
    expect((await snapshot(b, roomId)).kick_votes).toEqual([
      { target_user_id: target, votes: 1, needed: 2, expires_at: expect.any(String) },
    ]);
    expect((await voteKick(c, roomId, target)).kicked).toBe(true);
  });
});

describe("mid-game kick", () => {
  it("drops a producing submission so it never plays", async () => {
    const { players, roomId } = await roomWith(3);
    const [host, b, c] = players;
    await start(host, roomId);
    await submit(b, roomId);
    await submit(host, roomId);
    await kick(host, roomId, b);
    let s = await snapshot(host, roomId);
    expect(s.submitted_user_ids).toEqual([host]);
    await submit(c, roomId);
    s = await snapshot(host, roomId);
    expect(s.room.status).toBe("listening");
    expect(s.room.track_order).toHaveLength(2);
  });

  async function listening() {
    const { players, roomId } = await roomWith(3);
    const [host, b, c] = players;
    await start(host, roomId);
    const sub: Record<string, string> = {};
    for (const p of players) sub[p] = await submit(p, roomId);
    return { host, b, c, roomId, sub };
  }
  const setOrder = (roomId: string, order: string[], current: number) =>
    db.query(
      "update public.rooms set track_order = $2, current_track = $3, track_started_at = now() - interval '1 second' where id = $1",
      [roomId, order, current],
    );

  it("ends the kicked player's track at once if it is playing, keeping their votes on others", async () => {
    const { host, b, c, roomId, sub } = await listening();
    await setOrder(roomId, [sub[c], sub[b], sub[host]], 0);
    await rpc(db, b, "cast_vote", { p_room_id: roomId, p_submission_id: sub[c], p_score: 5 });
    await setOrder(roomId, [sub[c], sub[b], sub[host]], 1);

    await kick(host, roomId, b);
    const s = await snapshot(host, roomId);
    expect(s.room.track_order).toEqual([sub[c], sub[host]]);
    expect(s.room.current_track).toBe(1);
    expect((await db.query("select 1 from public.submissions where id = $1", [sub[b]])).rows).toEqual([]);
    expect((await db.query("select score from public.votes where voter_id = $1", [b])).rows).toEqual([{ score: 5 }]);
  });

  it("drops an upcoming track without touching the one playing", async () => {
    const { host, b, c, roomId, sub } = await listening();
    await setOrder(roomId, [sub[host], sub[b], sub[c]], 0);
    const before = (await snapshot(host, roomId)).room;
    await kick(host, roomId, c);
    const s = await snapshot(host, roomId);
    expect(s.room.track_order).toEqual([sub[host], sub[b]]);
    expect(s.room).toMatchObject({ current_track: 0, track_started_at: before.track_started_at });
  });

  it("goes to results without the kicked track when it was the last one playing", async () => {
    const { host, b, c, roomId, sub } = await listening();
    await setOrder(roomId, [sub[host], sub[c], sub[b]], 2);
    await kick(host, roomId, b);
    const s = await snapshot(host, roomId);
    expect(s.room.status).toBe("results");
    const { rows } = await db.query<{ user_id: string }>("select user_id from public.round_results where room_id = $1", [roomId]);
    expect(rows.map((r) => r.user_id).sort()).toEqual([host, c].sort());
  });
});

describe("bots", () => {
  it("kicking a bot removes it without a ban", async () => {
    await db.query("update public.app_config set dev_tools_enabled = true");
    const botId = await createUser(db);
    await db.transaction(async (tx) => {
      await tx.exec("set local role service_role");
      await tx.query("select public.dev_register_bot($1, 'bots/x.wav', 24000)", [botId]);
    });
    const { players, roomId } = await roomWith(1);
    await rpc(db, players[0], "dev_add_bot", { p_room_id: roomId });
    await kick(players[0], roomId, botId);
    expect(active(await snapshot(players[0], roomId), botId)).toBe(false);
    expect((await db.query("select 1 from public.room_bans where user_id = $1", [botId])).rows).toEqual([]);
    await rpc(db, players[0], "dev_add_bot", { p_room_id: roomId });
    expect(active(await snapshot(players[0], roomId), botId)).toBe(true);
  });
});
