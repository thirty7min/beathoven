import { beforeEach, describe, expect, it } from "vitest";
import { asService, asUser, createTestDb, createUser, rpc, rpcError, submitVerified, endReview, type TestDb } from "./harness";

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const FP_HEX = "0102030405060708";

type Assignment = { track_id: string; match_source: string | null } | null;
type Sub = { id: string; path: string };

const rooms = new Map<string, { roomId: string; round: number }>();

async function newSubmission(userId: string, durationMs = 120_000): Promise<Sub> {
  let room = rooms.get(userId);
  if (!room) {
    const created = await rpc<{ room_id: string }>(db, userId, "create_room", { p_mode: "creative" });
    room = { roomId: created.room_id, round: 100 };
    rooms.set(userId, room);
  }
  room.round++;
  const path = `${room.roomId}/${room.round}/${crypto.randomUUID()}.mp3`;
  const { rows } = await db.query<{ id: string }>(
    "insert into public.submissions (room_id, round, user_id, storage_path, duration_ms) values ($1, $2, $3, $4, $5) returning id",
    [room.roomId, room.round, userId, path, durationMs],
  );
  return { id: rows[0].id, path };
}

const service = <T>(sql: string, params: unknown[] = []) =>
  asService(db, async (tx) => (await tx.query<{ result: T }>(sql, params)).rows[0]?.result);

const register = (sub: Sub, sha: string | null = SHA_A, title: string | null = "My Beat") =>
  service<boolean>("select public.register_submission_audio($1, $2, $3, $4) as result", [sub.id, sub.path, sha, title]);

const assign = (
  sub: Sub,
  options: { fingerprint?: string | null; trackId?: string | null; score?: number; suggest?: string; suggestScore?: number; path?: string } = {},
) =>
  service<Assignment>("select public.assign_submission_track($1, $2, decode($3::text, 'hex'), $4, $5, $6, $7, $8) as result", [
    sub.id,
    options.path ?? sub.path,
    options.fingerprint === undefined ? FP_HEX : options.fingerprint,
    options.fingerprint === null ? "failed" : "done",
    options.trackId ?? null,
    options.score ?? null,
    options.suggest ?? null,
    options.suggestScore ?? null,
  ]);

async function processNew(userId: string, options: Parameters<typeof assign>[1] & { sha?: string; title?: string } = {}) {
  const sub = await newSubmission(userId);
  await register(sub, options.sha ?? crypto.randomUUID().replaceAll("-", "").padEnd(64, "0"), options.title ?? "My Beat");
  const result = await assign(sub, options);
  return { sub, trackId: result!.track_id, source: result!.match_source };
}

const trackOf = async (submissionId: string) =>
  (await db.query<{ track_id: string | null; match_source: string | null; match_score: number | null }>(
    "select track_id, match_source, match_score from public.submissions where id = $1",
    [submissionId],
  )).rows[0];

const tracks = async (userId: string) =>
  (await db.query<{ id: string; title: string; latest_submission_id: string | null }>(
    "select id, title, latest_submission_id from public.tracks where user_id = $1 order by created_at",
    [userId],
  )).rows;

describe("track assignment", () => {
  it("creates a titled track, then groups exact payload hashes", async () => {
    const user = await createUser(db);
    const first = await processNew(user, { sha: SHA_A, title: "  Night   Drive " });
    expect(first.source).toBeNull();
    expect(await tracks(user)).toEqual([{ id: first.trackId, title: "Night Drive", latest_submission_id: first.sub.id }]);

    const second = await processNew(user, { sha: SHA_A, fingerprint: null });
    expect(second).toMatchObject({ trackId: first.trackId, source: "exact" });
    expect((await trackOf(second.sub.id)).match_score).toBe(0);
    expect((await tracks(user))[0].latest_submission_id).toBe(second.sub.id);
  });

  it("falls back to a new untitled track when fingerprinting fails and nothing matches", async () => {
    const user = await createUser(db);
    const sub = await newSubmission(user);
    await register(sub, SHA_B, null);
    const result = await assign(sub, { fingerprint: null });
    expect((await tracks(user)).find((t) => t.id === result!.track_id)?.title).toBe("Untitled track");
    const { rows } = await db.query("select fingerprint_status, attempts from public.submission_fingerprints where submission_id = $1", [sub.id]);
    expect(rows[0]).toEqual({ fingerprint_status: "failed", attempts: 1 });
  });

  it("attaches fingerprint matches and records suggestions without chaining", async () => {
    const user = await createUser(db);
    const a = await processNew(user);
    const b = await processNew(user, { trackId: a.trackId, score: 0.08 });
    expect(b).toMatchObject({ trackId: a.trackId, source: "fingerprint" });
    expect((await trackOf(b.sub.id)).match_score).toBeCloseTo(0.08);

    const c = await processNew(user, { suggest: a.trackId, suggestScore: 0.2 });
    expect(c.trackId).not.toBe(a.trackId);
    const { rows } = await db.query("select track_id, score from public.track_suggestions where submission_id = $1", [c.sub.id]);
    expect(rows[0]).toMatchObject({ track_id: a.trackId });
  });

  it("ignores another user's track and keeps the exact tier per user", async () => {
    const [me, other] = [await createUser(db), await createUser(db)];
    const theirs = await processNew(other, { sha: SHA_A });
    const mine = await processNew(me, { sha: SHA_A, trackId: theirs.trackId, score: 0.01 });
    expect(mine.trackId).not.toBe(theirs.trackId);
    expect(mine.source).toBeNull();
  });

  it("returns candidates for the same user within the duration window only", async () => {
    const [me, other] = [await createUser(db), await createUser(db)];
    const near = await processNew(me);
    const far = await newSubmission(me, 300_000);
    await register(far);
    await assign(far);
    await processNew(other);
    const fresh = await newSubmission(me, 130_000);
    await register(fresh);
    const context = await service<{ candidates: { track_id: string; fingerprint: string }[] }>(
      "select public.track_match_context($1) as result",
      [fresh.id],
    );
    expect(context.candidates).toEqual([{ track_id: near.trackId, duration_ms: 120_000, fingerprint: `\\x${FP_HEX}` }]);
  });

  it("ignores stale paths after a replace and resets the track", async () => {
    const user = await createUser(db);
    const a = await processNew(user);
    const b = await processNew(user, { trackId: a.trackId, score: 0.05 });
    await db.query("update public.submissions set storage_path = $2 where id = $1", [b.sub.id, `${b.sub.path}.new`]);
    expect(await trackOf(b.sub.id)).toEqual({ track_id: null, match_source: null, match_score: null });
    expect((await db.query("select 1 from public.submission_fingerprints where submission_id = $1", [b.sub.id])).rows).toHaveLength(0);
    expect(await assign(b.sub)).toBeNull();
    expect((await tracks(user))[0].latest_submission_id).toBe(a.sub.id);
  });

  it("deletes a track once its last submission is gone", async () => {
    const user = await createUser(db);
    const a = await processNew(user);
    await db.query("delete from public.submissions where id = $1", [a.sub.id]);
    expect(await tracks(user)).toEqual([]);
  });

  it("re-matches a retried singleton but never a manually placed one", async () => {
    const user = await createUser(db);
    const a = await processNew(user);
    const retried = await processNew(user, { fingerprint: null });
    expect(retried.trackId).not.toBe(a.trackId);
    expect(await assign(retried.sub, { trackId: a.trackId, score: 0.1 })).toEqual({ track_id: a.trackId, match_source: "fingerprint" });
    expect(await tracks(user)).toHaveLength(1);

    const newId = await rpc<string>(db, user, "split_submission", { p_submission_id: retried.sub.id });
    expect(await assign(retried.sub, { trackId: a.trackId, score: 0.1 })).toEqual({ track_id: newId, match_source: "manual" });
  });
});

describe("owner track RPCs", () => {
  it("renames with validation, owner only", async () => {
    const [me, other] = [await createUser(db), await createUser(db)];
    const { trackId } = await processNew(me);
    await rpc(db, me, "rename_track", { p_track_id: trackId, p_title: "  Final\tMix  " });
    expect((await tracks(me))[0].title).toBe("Final Mix");
    expect(await rpcError(db, me, "rename_track", { p_track_id: trackId, p_title: "   " })).toBe("invalid_track_title");
    expect(await rpcError(db, me, "rename_track", { p_track_id: trackId, p_title: "x".repeat(81) })).toBe("invalid_track_title");
    expect(await rpcError(db, other, "rename_track", { p_track_id: trackId, p_title: "Mine" })).toBe("track_not_found");
  });

  it("split creates a track, records no-match and refuses the only submission", async () => {
    const user = await createUser(db);
    const a = await processNew(user, { title: "Original" });
    const b = await processNew(user, { trackId: a.trackId, score: 0.1, title: "Alt take" });
    const newId = await rpc<string>(db, user, "split_submission", { p_submission_id: b.sub.id });
    expect(await trackOf(b.sub.id)).toMatchObject({ track_id: newId, match_source: "manual" });
    expect((await tracks(user)).map((t) => t.title)).toEqual(["Original", "Alt take"]);
    expect(await rpcError(db, user, "split_submission", { p_submission_id: b.sub.id })).toBe("cannot_split_only_submission");

    const context = await service<{ candidates: unknown[] }>("select public.track_match_context($1) as result", [b.sub.id]);
    expect(context.candidates).toEqual([]);
  });

  it("merges tracks, re-pointing no-match pairs and suggestions", async () => {
    const [me, other] = [await createUser(db), await createUser(db)];
    const a = await processNew(me);
    const b = await processNew(me);
    const c = await processNew(me);
    await db.query("insert into public.track_no_match (track_a, track_b) values (least($1::uuid, $2::uuid), greatest($1::uuid, $2::uuid))", [
      b.trackId,
      c.trackId,
    ]);
    await db.query("insert into public.track_suggestions (submission_id, track_id, score) values ($1, $2, 0.2)", [c.sub.id, b.trackId]);

    await rpc(db, me, "merge_tracks", { p_target: a.trackId, p_source: b.trackId });
    expect(await trackOf(b.sub.id)).toMatchObject({ track_id: a.trackId, match_source: "manual" });
    expect((await tracks(me)).map((t) => t.id).sort()).toEqual([a.trackId, c.trackId].sort());
    const pairs = await db.query<{ track_a: string; track_b: string }>("select track_a, track_b from public.track_no_match");
    expect(pairs.rows).toEqual([{ track_a: [a.trackId, c.trackId].sort()[0], track_b: [a.trackId, c.trackId].sort()[1] }]);
    const suggestions = await db.query("select track_id from public.track_suggestions where submission_id = $1", [c.sub.id]);
    expect(suggestions.rows).toEqual([{ track_id: a.trackId }]);

    expect(await rpcError(db, me, "merge_tracks", { p_target: a.trackId, p_source: a.trackId })).toBe("cannot_merge_same_track");
    const theirs = await processNew(other);
    expect(await rpcError(db, me, "merge_tracks", { p_target: a.trackId, p_source: theirs.trackId })).toBe("track_not_found");
  });

  it("confirms or dismisses a suggestion", async () => {
    const user = await createUser(db);
    const a = await processNew(user);
    const b = await processNew(user, { suggest: a.trackId, suggestScore: 0.2 });
    expect(await rpc(db, user, "confirm_track_suggestion", { p_submission_id: b.sub.id })).toBe(a.trackId);
    expect(await trackOf(b.sub.id)).toMatchObject({ track_id: a.trackId, match_source: "manual" });
    expect(await tracks(user)).toHaveLength(1);
    expect(await rpcError(db, user, "confirm_track_suggestion", { p_submission_id: b.sub.id })).toBe("suggestion_not_found");

    const c = await processNew(user, { suggest: a.trackId, suggestScore: 0.22 });
    await rpc(db, user, "dismiss_track_suggestion", { p_submission_id: c.sub.id });
    expect((await trackOf(c.sub.id)).track_id).toBe(c.trackId);
    const context = await service<{ candidates: unknown[] }>("select public.track_match_context($1) as result", [c.sub.id]);
    expect(context.candidates).toEqual([]);
    expect(await assign(c.sub, { suggest: a.trackId, suggestScore: 0.2 })).toEqual({ track_id: c.trackId, match_source: null });
    expect((await db.query("select 1 from public.track_suggestions where submission_id = $1", [c.sub.id])).rows).toHaveLength(0);
  });

  it("lists the owner's tracks with submissions and suggestions", async () => {
    const user = await createUser(db);
    const a = await processNew(user, { title: "Keep" });
    const b = await processNew(user, { suggest: a.trackId, suggestScore: 0.2, title: "Maybe" });
    const mine = await rpc<{ id: string; submissions: { id: string }[]; suggestions: { track_title: string }[] }[]>(db, user, "get_my_tracks");
    expect(mine.map((t) => t.id)).toEqual([b.trackId, a.trackId]);
    expect(mine[0].suggestions).toEqual([{ submission_id: b.sub.id, track_id: a.trackId, track_title: "Keep", score: expect.any(Number) }]);
    expect(JSON.stringify(mine)).not.toContain("storage");
  });
});

describe("track permissions", () => {
  it("keeps tables and service functions away from clients", async () => {
    const user = await createUser(db);
    const { sub } = await processNew(user);
    for (const table of ["tracks", "submission_fingerprints", "track_no_match", "track_suggestions"]) {
      await expect(asUser(db, user, (tx) => tx.query(`select * from public.${table}`))).rejects.toThrow(/permission denied/);
    }
    for (const call of [
      ["register_submission_audio", { p_submission_id: sub.id, p_storage_path: sub.path, p_payload_sha256: SHA_A, p_title_hint: "x" }],
      ["track_match_context", { p_submission_id: sub.id }],
      ["fingerprint_retry_candidates", { p_limit: 5 }],
    ] as const) {
      expect(await rpcError(db, user, call[0], call[1])).toMatch(/permission denied/);
    }
  });
});

describe("fingerprint retries", () => {
  it("picks up unregistered, stuck pending and failed submissions with files", async () => {
    const user = await createUser(db);
    const bot = await createUser(db);
    await db.query("update public.profiles set is_bot = true where id = $1", [bot]);

    const unregistered = await newSubmission(user);
    const pending = await newSubmission(user);
    await register(pending);
    const failed = await processNew(user, { fingerprint: null });
    const done = await processNew(user);
    const purged = await newSubmission(user);
    await db.query("update public.submissions set purged_at = now() where id = $1", [purged.id]);
    const exhausted = await processNew(user, { fingerprint: null });
    await db.query("update public.submission_fingerprints set attempts = 5 where submission_id = $1", [exhausted.sub.id]);
    await newSubmission(bot);

    const candidates = () =>
      asService(db, async (tx) => (await tx.query<{ submission_id: string }>("select submission_id from public.fingerprint_retry_candidates(50)")).rows.map((r) => r.submission_id));
    expect(await candidates()).toEqual([]);

    await db.query("update public.submissions set submitted_at = now() - interval '2 hours'");
    await db.query("update public.submission_fingerprints set updated_at = now() - interval '2 hours'");
    expect((await candidates()).sort()).toEqual([unregistered.id, pending.id, failed.sub.id].sort());
    expect(done.trackId).toBeTruthy();
  });
});

async function finishedGame(players: string[], scores: Record<string, number>) {
  const room = await rpc<{ room_id: string; code: string }>(db, players[0], "create_room", { p_mode: "creative" });
  for (const p of players.slice(1)) await rpc(db, p, "join_room", { p_code: room.code });
  await db.query("update public.room_players set is_ready = true where room_id = $1", [room.room_id]);
  await rpc(db, players[0], "start_game", { p_room_id: room.room_id });
  const subs: Record<string, string> = {};
  for (const p of players) subs[p] = await submitVerified(db, p, room.room_id);
  for (let i = 0; i < players.length; i++) {
    const { rows } = await db.query<{ id: string; user_id: string }>(
      "select s.id, s.user_id from public.rooms r join public.submissions s on s.id = (r.track_order[r.current_track + 1])::uuid where r.id = $1",
      [room.room_id],
    );
    const current = rows[0];
    await db.query("update public.rooms set track_started_at = now() - interval '1 second' where id = $1", [room.room_id]);
    for (const voter of players.filter((p) => p !== current.user_id)) {
      await rpc(db, voter, "cast_vote", { p_room_id: room.room_id, p_submission_id: current.id, p_score: scores[current.user_id] });
    }
    await db.query(
      "update public.rooms set track_started_at = now() - interval '1 hour', phase_ends_at = now() - interval '2 seconds' where id = $1",
      [room.room_id],
    );
    await rpc(db, players[0], "advance_room", { p_room_id: room.room_id });
  }
  await endReview(db, room.room_id);
  for (const p of players) await rpc(db, p, "leave_room", { p_room_id: room.room_id });
  return { roomId: room.room_id, subs };
}

async function placeIn(submissionId: string, sha: string, trackId?: string) {
  const { rows } = await db.query<{ storage_path: string }>("select storage_path from public.submissions where id = $1", [submissionId]);
  const sub = { id: submissionId, path: rows[0].storage_path };
  await register(sub, sha, "Banger");
  return (await assign(sub, { trackId }))!.track_id;
}

describe("get_profile_tracks", () => {
  it("aggregates finished games per track and sorts", async () => {
    const [a, b, c] = [await createUser(db), await createUser(db), await createUser(db)];
    const g1 = await finishedGame([a, b, c], { [a]: 5, [b]: 3, [c]: 1 });
    const hit = await placeIn(g1.subs[a], SHA_A);
    const g2 = await finishedGame([a, b], { [a]: 4, [b]: 4 });
    expect(await placeIn(g2.subs[a], SHA_A)).toBe(hit);
    const g3 = await finishedGame([a, b], { [a]: 1, [b]: 5 });
    const flop = await placeIn(g3.subs[a], SHA_B);

    const { rows } = await db.query<{ username: string }>("select username from public.profiles where id = $1", [a]);
    const stats = await asUser(db, null, async (tx) => {
      await tx.exec("set local role anon");
      return (await tx.query<{ result: Record<string, unknown>[] }>("select public.get_profile_tracks($1) as result", [rows[0].username])).rows[0].result;
    });
    expect(stats).toEqual([
      {
        id: hit,
        title: "Banger",
        games: 2,
        plays: 3,
        wins: 2,
        win_rate: 1,
        avg_rating: 4.67,
        best_finish: 1,
        last_played_at: expect.any(String),
        latest_submission_id: g2.subs[a],
        duration_ms: 60_000,
        clip_start_ms: 0,
        clip_end_ms: 45_000,
        peaks: null,
        loudness_lufs: null,
        true_peak_dbtp: null,
        loudness_boost: true,
        playable: true,
      },
      {
        id: flop,
        title: "Banger",
        games: 1,
        plays: 1,
        wins: 0,
        win_rate: 0,
        avg_rating: 1,
        best_finish: 2,
        last_played_at: expect.any(String),
        latest_submission_id: g3.subs[a],
        duration_ms: 60_000,
        clip_start_ms: 0,
        clip_end_ms: 45_000,
        peaks: null,
        loudness_lufs: null,
        true_peak_dbtp: null,
        loudness_boost: true,
        playable: true,
      },
    ]);

    const recent = await rpc<{ id: string }[]>(db, b, "get_profile_tracks", { p_username: rows[0].username, p_sort: "recent" });
    expect(recent.map((t) => t.id)).toEqual([flop, hit]);
    const plays = await rpc<{ id: string }[]>(db, b, "get_profile_tracks", { p_username: rows[0].username, p_sort: "plays" });
    expect(plays.map((t) => t.id)).toEqual([hit, flop]);
    expect(await rpcError(db, b, "get_profile_tracks", { p_username: "nobody_here" })).toBe("profile_not_found");
  });

  it("ignores games that never reached results", async () => {
    const [a, b] = [await createUser(db), await createUser(db)];
    const room = await rpc<{ room_id: string; code: string }>(db, a, "create_room", { p_mode: "creative" });
    await rpc(db, b, "join_room", { p_code: room.code });
    await db.query("update public.room_players set is_ready = true where room_id = $1", [room.room_id]);
    await rpc(db, a, "start_game", { p_room_id: room.room_id });
    const sub = await submitVerified(db, a, room.room_id);
    await placeIn(sub, SHA_A);
    const { rows } = await db.query<{ username: string }>("select username from public.profiles where id = $1", [a]);
    expect(await rpc(db, b, "get_profile_tracks", { p_username: rows[0].username })).toEqual([]);
  });
});
