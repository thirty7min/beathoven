import { beforeEach, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, endReview, rpc, rpcError, submitVerified, type TestDb } from "./harness";

type ReviewEntry = {
  submission_id: string;
  position: number;
  clip_start_ms: number;
  clip_end_ms: number;
  is_mine: boolean;
  my_vote: number | null;
  is_default: boolean;
};
type State = {
  room: { status: string; track_order: string[]; phase_started_at: string; phase_ends_at: string };
  submissions: { id: string; user_id: string | null; storage_path: string; clip_start_ms: number }[];
  votes_cast: unknown[];
  review: { done_user_ids: string[]; total: number } | null;
  my_review: ReviewEntry[] | null;
  results: { user_id: string; avg_score: number | null; vote_count: number }[];
};

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});

const snapshot = (userId: string, roomId: string) => rpc<State>(db, userId, "get_room_snapshot", { p_room_id: roomId });

const ownerOf = async (submissionId: string) =>
  (await db.query<{ user_id: string }>("select user_id from public.submissions where id = $1", [submissionId])).rows[0].user_id;

const vote = (voter: string, roomId: string, submissionId: string, score: number) =>
  rpc(db, voter, "cast_vote", { p_room_id: roomId, p_submission_id: submissionId, p_score: score });

async function endTrack(roomId: string, host: string) {
  await db.query(
    "update public.rooms set track_started_at = now() - interval '1 hour', phase_ends_at = now() - interval '2 seconds' where id = $1",
    [roomId],
  );
  await rpc(db, host, "advance_room", { p_room_id: roomId });
}

async function reviewingRoom(n = 3, settings: Record<string, unknown> = {}, { voteDuringListening = true } = {}) {
  const players = await Promise.all(Array.from({ length: n }, () => createUser(db)));
  const room = await rpc<{ room_id: string; code: string }>(db, players[0], "create_room", { p_mode: "creative", ...settings });
  for (const p of players.slice(1)) await rpc(db, p, "join_room", { p_code: room.code });
  await db.query("update public.room_players set is_ready = true where room_id = $1", [room.room_id]);
  await rpc(db, players[0], "start_game", { p_room_id: room.room_id });
  for (const p of players) await submitVerified(db, p, room.room_id);
  const order = (await snapshot(players[0], room.room_id)).room.track_order;
  for (const track of order) {
    if (voteDuringListening) {
      await db.query("update public.rooms set track_started_at = now() - interval '1 second' where id = $1", [room.room_id]);
      const owner = await ownerOf(track);
      for (const voter of players.filter((p) => p !== owner)) await vote(voter, room.room_id, track, 2);
    }
    await endTrack(room.room_id, players[0]);
  }
  return { players, roomId: room.room_id, order };
}

describe("review phase", () => {
  it("follows listening for 30 seconds, then results at the deadline", async () => {
    const { players, roomId } = await reviewingRoom(2);
    const s = await snapshot(players[0], roomId);
    expect(s.room.status).toBe("reviewing");
    expect(Date.parse(s.room.phase_ends_at) - Date.parse(s.room.phase_started_at)).toBe(30_000);
    expect(s.results).toEqual([]);
    expect((await db.query("select 1 from public.round_results")).rows).toHaveLength(0);

    await rpc(db, players[0], "advance_room", { p_room_id: roomId });
    expect((await snapshot(players[0], roomId)).room.status).toBe("reviewing");
    await endReview(db, roomId);
    expect((await snapshot(players[0], roomId)).room.status).toBe("results");
  });

  it("lists every entry in track order with the caller's vote and clip", async () => {
    const { players, roomId, order } = await reviewingRoom(3, {}, { voteDuringListening: false });
    const s = await snapshot(players[0], roomId);
    expect(s.my_review!.map((e) => e.submission_id)).toEqual(order);
    expect(s.my_review!.map((e) => e.position)).toEqual([1, 2, 3]);
    const mine = s.my_review!.find((e) => e.is_mine)!;
    expect(mine).toMatchObject({ my_vote: null, is_default: false, clip_start_ms: 0, clip_end_ms: 45_000 });
    for (const entry of s.my_review!.filter((e) => !e.is_mine)) expect(entry).toMatchObject({ my_vote: 3, is_default: true });
    expect(s.review).toEqual({ done_user_ids: [], total: 3 });
  });

  it("lets voters change any rating except their own and results use the final votes", async () => {
    const { players, roomId, order } = await reviewingRoom(2);
    const [a, b] = players;
    const aTrack = (await ownerOf(order[0])) === a ? order[0] : order[1];
    const bTrack = aTrack === order[0] ? order[1] : order[0];

    await vote(a, roomId, bTrack, 5);
    await vote(a, roomId, bTrack, 4);
    expect(await rpcError(db, a, "cast_vote", { p_room_id: roomId, p_submission_id: aTrack, p_score: 5 })).toBe("self_vote");
    expect(await rpcError(db, a, "cast_vote", { p_room_id: roomId, p_submission_id: bTrack, p_score: 6 })).toBe("invalid_score");
    expect((await snapshot(a, roomId)).my_review!.find((e) => e.submission_id === bTrack)).toMatchObject({ my_vote: 4, is_default: false });

    await endReview(db, roomId);
    const s = await snapshot(a, roomId);
    expect(s.results.find((r) => r.user_id === b)).toMatchObject({ avg_score: 4, vote_count: 1 });
    expect(s.results.find((r) => r.user_id === a)).toMatchObject({ avg_score: 2, vote_count: 1 });
    const { rows } = await db.query<{ id: string; wins: number }>("select id, wins from public.profiles where id = any($1)", [players]);
    expect(rows.find((r) => r.id === b)!.wins).toBe(1);
  });

  it("overwrites defaulted votes and clears the default flag", async () => {
    const { players, roomId, order } = await reviewingRoom(2, {}, { voteDuringListening: false });
    const [a] = players;
    const target = (await ownerOf(order[0])) === a ? order[1] : order[0];
    const before = await db.query<{ score: number; is_default: boolean }>(
      "select score, is_default from public.votes where submission_id = $1 and voter_id = $2",
      [target, a],
    );
    expect(before.rows[0]).toEqual({ score: 3, is_default: true });
    await vote(a, roomId, target, 1);
    const after = await db.query("select score, is_default from public.votes where submission_id = $1 and voter_id = $2", [target, a]);
    expect(after.rows[0]).toEqual({ score: 1, is_default: false });
  });

  it("ends early once every fresh human has finished", async () => {
    const { players, roomId } = await reviewingRoom(3);
    const [a, b, c] = players;
    expect(await rpc(db, a, "finish_review", { p_room_id: roomId })).toEqual({ advanced: false });
    expect(await rpc(db, a, "finish_review", { p_room_id: roomId })).toEqual({ advanced: false });
    expect((await snapshot(b, roomId)).review).toEqual({ done_user_ids: [a], total: 3 });
    await vote(a, roomId, (await snapshot(a, roomId)).my_review!.find((e) => !e.is_mine)!.submission_id, 5);

    await db.query("update public.room_players set last_seen_at = now() - interval '5 minutes' where user_id = $1", [c]);
    expect(await rpc(db, b, "finish_review", { p_room_id: roomId })).toEqual({ advanced: true });
    expect((await snapshot(a, roomId)).room.status).toBe("results");
    expect(await rpcError(db, a, "finish_review", { p_room_id: roomId })).toBe("wrong_phase");
  });

  it("treats bots as done", async () => {
    await db.query("update public.app_config set dev_tools_enabled = true");
    const host = await createUser(db);
    const bot = await createUser(db);
    await db.transaction(async (tx) => {
      await tx.exec("set local role service_role");
      await tx.query("select public.dev_register_bot($1, 'bots/review.wav', 40000)", [bot]);
    });
    const room = await rpc<{ room_id: string }>(db, host, "create_room", { p_mode: "creative" });
    await rpc(db, host, "dev_add_bot", { p_room_id: room.room_id });
    await rpc(db, host, "set_ready", { p_room_id: room.room_id, p_ready: true });
    await rpc(db, host, "start_game", { p_room_id: room.room_id });
    await submitVerified(db, host, room.room_id);
    for (let i = 0; i < 2; i++) await endTrack(room.room_id, host);
    const s = await snapshot(host, room.room_id);
    expect(s.room.status).toBe("reviewing");
    expect(s.review).toEqual({ done_user_ids: [], total: 1 });
    expect(await rpc(db, host, "finish_review", { p_room_id: room.room_id })).toEqual({ advanced: true });
  });

  it("keeps producers hidden in blind rooms but lets members stream every entry", async () => {
    const { players, roomId } = await reviewingRoom(3);
    const [a] = players;
    const s = await snapshot(a, roomId);
    const others = s.submissions.filter((x) => s.my_review!.find((e) => e.submission_id === x.id && !e.is_mine));
    expect(others.every((x) => x.user_id === null)).toBe(true);
    expect(s.votes_cast).toEqual([]);
    expect(JSON.stringify(s.my_review)).not.toContain(players[1]);
    const rows = await asUser(db, a, (tx) => tx.query("select * from public.submissions where user_id <> $1", [a]));
    expect(rows.rows).toHaveLength(0);
    for (const x of s.submissions) {
      const ok = await asUser(db, a, async (tx) =>
        (await tx.query<{ ok: boolean }>("select public.can_read_submission($1) as ok", [x.storage_path])).rows[0].ok,
      );
      expect(ok).toBe(true);
    }
  });

  it("shows producers during review when names are revealed", async () => {
    const { players, roomId } = await reviewingRoom(2, { p_reveal_names: true });
    const s = await snapshot(players[0], roomId);
    expect(s.submissions.map((x) => x.user_id).sort()).toEqual([...players].sort());
  });

  it("survives a kick and a leave during review", async () => {
    const { players, roomId, order } = await reviewingRoom(3);
    const [host, b, c] = players;
    const bTrack = order[(await Promise.all(order.map(ownerOf))).indexOf(b)];
    await rpc(db, host, "kick_player", { p_room_id: roomId, p_user_id: b });
    let s = await snapshot(host, roomId);
    expect(s.room.status).toBe("reviewing");
    expect(s.room.track_order).not.toContain(bTrack);
    expect(await rpcError(db, host, "cast_vote", { p_room_id: roomId, p_submission_id: bTrack, p_score: 5 })).toBe(
      "not_current_track",
    );
    await rpc(db, c, "leave_room", { p_room_id: roomId });
    expect(await rpc(db, host, "finish_review", { p_room_id: roomId })).toEqual({ advanced: true });
    s = await snapshot(host, roomId);
    expect(s.room.status).toBe("results");
    expect(s.results.map((r) => r.user_id).sort()).toEqual([host, c].sort());
  });
});
