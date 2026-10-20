import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, createUser, rpc, rpcError, submitVerified, type TestDb } from "./harness";

type Player = { user_id: string; left_at: string | null; role: string; leave_pending_at: string | null };
type State = {
  version: number;
  room: { status: string; host_id: string };
  players: Player[];
  current_votes: { count: number; eligible: number } | null;
  my_submission: { id: string } | null;
};
type Reap = { removed: boolean; retry_in_ms: number | null };

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});

const users = (n: number) => Promise.all(Array.from({ length: n }, () => createUser(db)));
const snapshot = (userId: string, roomId: string) => rpc<State>(db, userId, "get_room_snapshot", { p_room_id: roomId });
const join = (userId: string, code: string) => rpc<{ role: string }>(db, userId, "join_room", { p_code: code });
const heartbeat = (userId: string, tab?: string) => rpc(db, userId, "room_heartbeat", tab ? { p_tab_id: tab } : {});
const markLeaving = (userId: string, tab?: string) =>
  rpc<boolean>(db, userId, "mark_leave_pending", tab ? { p_tab_id: tab } : {});
const reap = (by: string, roomId: string, target: string) =>
  rpc<Reap>(db, by, "reap_member", { p_room_id: roomId, p_user_id: target });
const sweep = () => db.query("select public.sweep_rooms()");
const roleOf = (s: State, userId: string) => s.players.find((p) => p.user_id === userId && p.left_at === null)?.role ?? null;
const pendingAt = async (roomId: string, userId: string) =>
  (
    await db.query<{ at: string | null }>(
      "select leave_pending_at::text as at from public.room_players where room_id = $1 and user_id = $2",
      [roomId, userId],
    )
  ).rows[0].at;
const pendingFor = (roomId: string, userId: string, seconds: number) =>
  db.query("update public.room_players set leave_pending_at = now() - make_interval(secs => $3) where room_id = $1 and user_id = $2", [
    roomId,
    userId,
    seconds,
  ]);
const expirePhase = (roomId: string) =>
  db.query("update public.rooms set phase_ends_at = now() - interval '2 seconds' where id = $1", [roomId]);

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

async function closeTab(roomId: string, userId: string, tab = "tab-a") {
  await heartbeat(userId, tab);
  expect(await markLeaving(userId, tab)).toBe(true);
  await pendingFor(roomId, userId, 9);
}

describe("mark_leave_pending", () => {
  it("marks the caller's membership, bumps the room and is cleared by a heartbeat", async () => {
    const { players, roomId } = await lobby(2);
    const before = (await snapshot(players[0], roomId)).version;
    expect(await markLeaving(players[1])).toBe(true);
    const s = await snapshot(players[0], roomId);
    expect(s.version).toBeGreaterThan(before);
    expect(s.players.find((p) => p.user_id === players[1])!.leave_pending_at).not.toBeNull();
    await heartbeat(players[1]);
    expect(await pendingAt(roomId, players[1])).toBeNull();
  });

  it("is cleared by the user's own snapshot", async () => {
    const { players, roomId } = await lobby(2);
    await markLeaving(players[1]);
    await snapshot(players[1], roomId);
    expect(await pendingAt(roomId, players[1])).toBeNull();
  });

  it("does nothing outside a room or for anonymous callers", async () => {
    expect(await markLeaving(await createUser(db))).toBe(false);
    expect(await rpcError(db, null, "mark_leave_pending")).toMatch("not_authenticated");
  });

  it("keeps the first mark when a second beacon arrives", async () => {
    const { players, roomId } = await lobby(2);
    await markLeaving(players[1]);
    await pendingFor(roomId, players[1], 7);
    expect(await markLeaving(players[1])).toBe(false);
    expect((await reap(players[0], roomId, players[1])).retry_in_ms).toBeLessThanOrEqual(1000);
  });
});

describe("reap_member", () => {
  it("removes only once the mark is older than 8s", async () => {
    const { players, roomId } = await lobby(3);
    await markLeaving(players[2]);
    const early = await reap(players[0], roomId, players[2]);
    expect(early.removed).toBe(false);
    expect(early.retry_in_ms).toBeGreaterThan(7000);
    expect(early.retry_in_ms).toBeLessThanOrEqual(8000);
    await pendingFor(roomId, players[2], 6);
    expect((await reap(players[0], roomId, players[2])).removed).toBe(false);
    await pendingFor(roomId, players[2], 8.5);
    expect(await reap(players[1], roomId, players[2])).toEqual({ removed: true, retry_in_ms: null });
    expect(roleOf(await snapshot(players[0], roomId), players[2])).toBeNull();
    expect(await reap(players[0], roomId, players[2])).toEqual({ removed: false, retry_in_ms: null });
  });

  it("leaves present members alone and hands the host on", async () => {
    const { players, roomId } = await lobby(3);
    expect(await reap(players[1], roomId, players[2])).toEqual({ removed: false, retry_in_ms: null });
    await closeTab(roomId, players[0]);
    expect((await reap(players[1], roomId, players[0])).removed).toBe(true);
    expect((await snapshot(players[1], roomId)).room.host_id).toBe(players[1]);
  });

  it("removes members idle past the lobby grace", async () => {
    const { players, roomId } = await lobby(2);
    await db.query("update public.room_players set last_seen_at = now() - interval '91 seconds' where room_id = $1 and user_id = $2", [
      roomId,
      players[1],
    ]);
    expect((await reap(players[0], roomId, players[1])).removed).toBe(true);
  });

  it("never asks for a retry once the room has closed", async () => {
    const { players, roomId } = await lobby(2);
    await markLeaving(players[1]);
    await db.query("update public.rooms set status = 'closed' where id = $1", [roomId]);
    expect(await reap(players[0], roomId, players[1])).toEqual({ removed: false, retry_in_ms: null });
  });

  it("is only for members of the room", async () => {
    const { players, roomId } = await lobby(2);
    expect(await rpcError(db, await createUser(db), "reap_member", { p_room_id: roomId, p_user_id: players[1] })).toMatch(
      "not_member",
    );
  });
});

describe("refresh", () => {
  it("keeps a member whose reloaded page beats after the beacon", async () => {
    const { players, roomId } = await lobby(2);
    await heartbeat(players[1], "old");
    expect(await markLeaving(players[1], "old")).toBe(true);
    await heartbeat(players[1], "new");
    expect(await pendingAt(roomId, players[1])).toBeNull();
    expect((await reap(players[0], roomId, players[1])).removed).toBe(false);
    await sweep();
    expect(roleOf(await snapshot(players[0], roomId), players[1])).toBe("player");
  });

  it("ignores a late beacon from the page that was replaced", async () => {
    const { players, roomId } = await lobby(2);
    await heartbeat(players[1], "old");
    await heartbeat(players[1], "new");
    expect(await markLeaving(players[1], "old")).toBe(false);
    expect(await pendingAt(roomId, players[1])).toBeNull();
  });

  it("clears the mark when the reloaded page rejoins before beating", async () => {
    const { players, roomId, code } = await producing(2);
    await heartbeat(players[1], "old");
    await markLeaving(players[1], "old");
    await join(players[1], code);
    expect(await pendingAt(roomId, players[1])).toBeNull();
    await sweep();
    expect(roleOf(await snapshot(players[0], roomId), players[1])).toBe("player");
  });
});

describe("sweep backstop", () => {
  it("removes marked members after 8s in any phase", async () => {
    const { players, roomId } = await producing(3);
    await markLeaving(players[1]);
    await sweep();
    expect(roleOf(await snapshot(players[0], roomId), players[1])).toBe("player");
    await pendingFor(roomId, players[1], 9);
    await sweep();
    expect(roleOf(await snapshot(players[0], roomId), players[1])).toBeNull();
  });

  it("still leaves unmarked idle players in place mid-game", async () => {
    const { players, roomId } = await producing(2);
    await db.query("update public.room_players set last_seen_at = now() - interval '90 seconds' where room_id = $1 and user_id = $2", [
      roomId,
      players[1],
    ]);
    await sweep();
    expect(roleOf(await snapshot(players[0], roomId), players[1])).toBe("player");
  });
});

describe("inactivity", () => {
  const idleFor = (roomId: string, userId: string, seconds: number) =>
    db.query("update public.room_players set last_seen_at = now() - make_interval(secs => $3) where room_id = $1 and user_id = $2", [
      roomId,
      userId,
      seconds,
    ]);
  const silentSinceBeforeStart = (roomId: string, userId: string) =>
    db.query(
      "update public.room_players rp set last_seen_at = r.game_started_at - interval '1 second' from public.rooms r where r.id = rp.room_id and rp.room_id = $1 and rp.user_id = $2",
      [roomId, userId],
    );
  const status = async (roomId: string) =>
    (await db.query<{ status: string }>("select status from public.rooms where id = $1", [roomId])).rows[0].status;

  async function advanceTo(roomId: string, by: string, target: string) {
    for (let i = 0; i < 10 && (await status(roomId)) !== target; i++) {
      await db.query(
        "update public.rooms set phase_ends_at = now() - interval '2 seconds', track_started_at = now() - interval '1 hour' where id = $1",
        [roomId],
      );
      await rpc(db, by, "advance_room", { p_room_id: roomId });
    }
    expect(await status(roomId)).toBe(target);
  }

  async function submitted(n: number) {
    const room = await producing(n);
    for (const p of room.players) await submitVerified(db, p, room.roomId);
    return room;
  }

  it("never removes a silent player mid-game, in any phase, even after 10 minutes", async () => {
    const { players, roomId } = await producing(3);
    await idleFor(roomId, players[2], 600);
    await sweep();
    expect((await reap(players[0], roomId, players[2])).removed).toBe(false);
    expect(roleOf(await snapshot(players[0], roomId), players[2])).toBe("player");

    for (const p of players.slice(0, 2)) await submitVerified(db, p, roomId);
    for (const phase of ["listening", "reviewing"]) {
      await advanceTo(roomId, players[0], phase);
      await idleFor(roomId, players[2], 600);
      await sweep();
      expect((await reap(players[1], roomId, players[2])).removed).toBe(false);
      expect(roleOf(await snapshot(players[0], roomId), players[2])).toBe("player");
    }
  });

  it("removes lobby members at 90s of silence but not at 89s", async () => {
    const { players, roomId } = await lobby(3);
    await idleFor(roomId, players[1], 90);
    await idleFor(roomId, players[2], 89);
    await sweep();
    const s = await snapshot(players[0], roomId);
    expect(roleOf(s, players[1])).toBeNull();
    expect(roleOf(s, players[2])).toBe("player");
  });

  it("keeps players silent for the whole game through results, with their entry and score, then removes them back in the lobby", async () => {
    const { players, roomId } = await submitted(3);
    await silentSinceBeforeStart(roomId, players[2]);
    await advanceTo(roomId, players[0], "results");
    expect(roleOf(await snapshot(players[0], roomId), players[2])).toBe("player");
    const { rows } = await db.query<{ user_id: string }>("select user_id from public.round_results where room_id = $1", [roomId]);
    expect(rows.map((r) => r.user_id)).toContain(players[2]);

    await advanceTo(roomId, players[0], "lobby");
    expect(roleOf(await snapshot(players[0], roomId), players[2])).toBeNull();
    expect(await heartbeat(players[2])).toBeNull();
  });

  it("keeps players who were seen at any point after the start", async () => {
    const { players, roomId } = await submitted(3);
    await silentSinceBeforeStart(roomId, players[2]);
    await heartbeat(players[2]);
    await advanceTo(roomId, players[0], "lobby");
    expect(roleOf(await snapshot(players[0], roomId), players[2])).toBe("player");
  });

  it("hands the host on when the silent player is the host", async () => {
    const { players, roomId } = await submitted(3);
    await silentSinceBeforeStart(roomId, players[0]);
    await advanceTo(roomId, players[1], "results");
    expect((await snapshot(players[1], roomId)).room.host_id).toBe(players[0]);
    await advanceTo(roomId, players[1], "lobby");
    const s = await snapshot(players[1], roomId);
    expect(roleOf(s, players[0])).toBeNull();
    expect(s.room.host_id).toBe(players[1]);
    expect(s.players.filter((p) => p.left_at === null).map((p) => p.user_id)).toEqual([players[1], players[2]]);
  });
});

describe("mid-game removal", () => {
  it("moves producing on once the remaining players have submitted, keeping the leaver's entry", async () => {
    const { players, roomId } = await producing(3);
    await submitVerified(db, players[0], roomId);
    await submitVerified(db, players[1], roomId);
    const leaverEntry = await submitVerified(db, players[2], roomId, 60000, { confirm: false });
    await closeTab(roomId, players[2]);
    expect((await reap(players[0], roomId, players[2])).removed).toBe(true);
    const s = await snapshot(players[0], roomId);
    expect(s.room.status).toBe("listening");
    const { rows } = await db.query<{ track_order: string[] }>("select track_order from public.rooms where id = $1", [roomId]);
    expect(rows[0].track_order).toContain(leaverEntry);
    expect(s.players.find((p) => p.user_id === players[2])!.left_at).not.toBeNull();
  });

  it("recomputes the voters and hands the host to a player while listening", async () => {
    const { players, roomId, code } = await producing(4);
    const fan = await createUser(db);
    expect((await join(fan, code)).role).toBe("spectator");
    for (const p of players) await submitVerified(db, p, roomId);
    await db.query("update public.rooms set track_started_at = now() - interval '1 second' where id = $1", [roomId]);
    const before = (await snapshot(players[1], roomId)).current_votes!.eligible;
    await closeTab(roomId, players[0]);
    expect((await reap(fan, roomId, players[0])).removed).toBe(true);
    const s = await snapshot(players[1], roomId);
    expect(s.room.host_id).not.toBe(fan);
    expect(players.slice(1)).toContain(s.room.host_id);
    const { rows } = await db.query<{ user_id: string }>(
      "select s.user_id from public.rooms r join public.submissions s on s.id = r.track_order[r.current_track + 1] where r.id = $1",
      [roomId],
    );
    const leaverIsProducer = rows[0].user_id === players[0];
    expect(s.current_votes!.eligible).toBe(leaverIsProducer ? before : before - 1);
  });
});

describe("rejoining", () => {
  it("gets the player seat and the submission back during producing, and can replace it", async () => {
    const { players, roomId, code } = await producing(3);
    const first = await submitVerified(db, players[2], roomId);
    await rpc(db, players[2], "leave_room", { p_room_id: roomId });
    expect((await join(players[2], code)).role).toBe("player");
    const s = await snapshot(players[2], roomId);
    expect(s.room.status).toBe("producing");
    expect(s.my_submission?.id).toBe(first);
    expect(s.players.map((p) => p.user_id)).toEqual(players);
    const replaced = await submitVerified(db, players[2], roomId);
    expect((await snapshot(players[2], roomId)).my_submission?.id).toBe(replaced);
  });

  it("gets the seat back after a closed tab is reaped while premade uploads are open", async () => {
    const { players, roomId, code } = await producing(3, { p_mode: "premade" });
    await closeTab(roomId, players[1]);
    expect((await reap(players[0], roomId, players[1])).removed).toBe(true);
    expect((await join(players[1], code)).role).toBe("player");
    await submitVerified(db, players[1], roomId);
  });

  it("spectates once the upload phase is over", async () => {
    const { players, roomId, code } = await producing(3);
    await submitVerified(db, players[0], roomId);
    await rpc(db, players[2], "leave_room", { p_room_id: roomId });
    await expirePhase(roomId);
    await rpc(db, players[0], "advance_room", { p_room_id: roomId });
    expect((await snapshot(players[0], roomId)).room.status).toBe("listening");
    expect((await join(players[2], code)).role).toBe("spectator");
  });

  it("spectates when they left before the game started", async () => {
    const { players, roomId, code } = await lobby(3);
    await rpc(db, players[2], "leave_room", { p_room_id: roomId });
    await rpc(db, players[0], "start_game", { p_room_id: roomId, p_force: true });
    expect((await join(players[2], code)).role).toBe("spectator");
  });

  it("spectates when the room has no free seat", async () => {
    const { players, roomId, code } = await producing(3);
    await rpc(db, players[2], "leave_room", { p_room_id: roomId });
    await db.query("update public.rooms set max_players = 2 where id = $1", [roomId]);
    expect((await join(players[2], code)).role).toBe("spectator");
  });

  it("never lets a kicked player back in", async () => {
    const { players, roomId, code } = await producing(3);
    await rpc(db, players[0], "kick_player", { p_room_id: roomId, p_user_id: players[2] });
    expect(await rpcError(db, players[2], "join_room", { p_code: code })).toMatch("banned_from_room");
  });
});
