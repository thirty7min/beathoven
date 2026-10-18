import { beforeEach, describe, expect, it } from "vitest";
import { asService, asUser, createTestDb, createUser, endReview, rpc, rpcError, submitVerified, verifiedUpload, type TestDb } from "./harness";

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const PEAKS = Array.from({ length: 120 }, (_, i) => (i * 7) % 256);

type ProfileTrack = {
  id: string;
  latest_submission_id: string | null;
  duration_ms: number | null;
  clip_start_ms: number | null;
  clip_end_ms: number | null;
  peaks: number[] | null;
  playable: boolean;
};

const service = <T>(sql: string, params: unknown[] = []) =>
  asService(db, async (tx) => (await tx.query<{ result: T }>(sql, params)).rows[0]?.result);

const pathOf = async (submissionId: string) =>
  (await db.query<{ storage_path: string }>("select storage_path from public.submissions where id = $1", [submissionId])).rows[0]
    .storage_path;

async function placeIn(submissionId: string, sha: string, trackId?: string) {
  const path = await pathOf(submissionId);
  await service("select public.register_submission_audio($1, $2, $3, 'Banger') as result", [submissionId, path, sha]);
  return (
    await service<{ track_id: string }>(
      "select public.assign_submission_track($1, $2, decode('0102030405060708', 'hex'), 'done', $3, null, null, null) as result",
      [submissionId, path, trackId ?? null],
    )
  ).track_id;
}

async function producingRoom(players: string[]) {
  const room = await rpc<{ room_id: string; code: string }>(db, players[0], "create_room", { p_mode: "creative" });
  for (const p of players.slice(1)) await rpc(db, p, "join_room", { p_code: room.code });
  await db.query("update public.room_players set is_ready = true where room_id = $1", [room.room_id]);
  await rpc(db, players[0], "start_game", { p_room_id: room.room_id });
  return room.room_id;
}

async function playThrough(roomId: string, host: string, { review = true } = {}) {
  const { rows } = await db.query<{ n: number }>("select cardinality(track_order) as n from public.rooms where id = $1", [roomId]);
  for (let i = 0; i < rows[0].n; i++) {
    await db.query(
      "update public.rooms set track_started_at = now() - interval '1 hour', phase_ends_at = now() - interval '2 seconds' where id = $1",
      [roomId],
    );
    await rpc(db, host, "advance_room", { p_room_id: roomId });
  }
  if (review) await endReview(db, roomId);
}

async function finishedGame(players: string[], { close = true } = {}) {
  const roomId = await producingRoom(players);
  const subs: Record<string, string> = {};
  for (const p of players) subs[p] = await submitVerified(db, p, roomId);
  await playThrough(roomId, players[0]);
  if (close) for (const p of players) await rpc(db, p, "leave_room", { p_room_id: roomId });
  return { roomId, subs };
}

async function ageRooms(roomIds: string[]) {
  await db.query("alter table public.rooms disable trigger rooms_touch");
  await db.query("update public.rooms set status = 'closed', updated_at = now() - interval '31 days' where id = any($1)", [roomIds]);
  await db.query("alter table public.rooms enable trigger rooms_touch");
}

const due = async () =>
  asService(db, async (tx) =>
    (await tx.query<{ submission_id: string }>("select * from public.submissions_due_for_purge()")).rows.map((r) => r.submission_id),
  );

const latestOf = async (trackId: string) =>
  (await db.query<{ latest_submission_id: string | null }>("select latest_submission_id from public.tracks where id = $1", [trackId]))
    .rows[0]?.latest_submission_id;

const stream = (trackId: string, requester = "user:test") =>
  service<{ submission_id: string; storage_path: string }>("select public.get_track_stream($1, $2) as result", [trackId, requester]);

const streamError = async (trackId: string, requester = "user:test") => {
  try {
    await stream(trackId, requester);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected get_track_stream to fail");
};

const usernameOf = async (userId: string) =>
  (await db.query<{ username: string }>("select username from public.profiles where id = $1", [userId])).rows[0].username;

const profileTracks = async (userId: string) =>
  rpc<ProfileTrack[]>(db, null, "get_profile_tracks", { p_username: await usernameOf(userId) });

describe("retention", () => {
  it("keeps each track's latest file past the closed-room purge and frees older ones", async () => {
    const [a, b] = [await createUser(db), await createUser(db)];
    const g1 = await finishedGame([a, b]);
    const track = await placeIn(g1.subs[a], SHA_A);
    const g2 = await finishedGame([a, b]);
    expect(await placeIn(g2.subs[a], SHA_A)).toBe(track);
    await ageRooms([g1.roomId, g2.roomId]);

    const purgeable = await due();
    expect(purgeable).toContain(g1.subs[a]);
    expect(purgeable).not.toContain(g2.subs[a]);
    expect(purgeable).toContain(g1.subs[b]);
  });

  it("moves the latest pointer and file eligibility on merge and split", async () => {
    const [a, b] = [await createUser(db), await createUser(db)];
    const g1 = await finishedGame([a, b]);
    const older = await placeIn(g1.subs[a], SHA_A);
    const g2 = await finishedGame([a, b]);
    const newer = await placeIn(g2.subs[a], SHA_B);
    expect(newer).not.toBe(older);
    await ageRooms([g1.roomId, g2.roomId]);
    expect(await due()).not.toContain(g1.subs[a]);

    await rpc(db, a, "merge_tracks", { p_target: older, p_source: newer });
    expect(await latestOf(older)).toBe(g2.subs[a]);
    expect(await due()).toContain(g1.subs[a]);
    expect(await due()).not.toContain(g2.subs[a]);

    const split = await rpc<string>(db, a, "split_submission", { p_submission_id: g2.subs[a] });
    expect(await latestOf(split)).toBe(g2.subs[a]);
    expect(await latestOf(older)).toBe(g1.subs[a]);
    expect(await due()).not.toContain(g1.subs[a]);
    expect(await due()).not.toContain(g2.subs[a]);
  });

  it("queues files for removal when their submission is deleted, including account deletion", async () => {
    const [a, b] = [await createUser(db), await createUser(db)];
    const g1 = await finishedGame([a, b]);
    await placeIn(g1.subs[a], SHA_A);
    const purged = await finishedGame([a, b]);
    await service("select public.mark_submissions_purged($1) as result", [[purged.subs[a]]]);
    const keep = await pathOf(g1.subs[b]);
    const expected = [await pathOf(g1.subs[a])];

    await db.query("delete from auth.users where id = $1", [a]);
    const queued = () => asService(db, async (tx) => (await tx.query<{ path: string }>("select public.queued_submission_object_purges() as path")).rows.map((r) => r.path));
    expect(await queued()).toEqual(expected);
    expect(await queued()).not.toContain(keep);
    expect((await db.query("select 1 from public.tracks where user_id = $1", [a])).rows).toHaveLength(0);

    await service("select public.clear_submission_object_purges($1) as result", [expected]);
    expect(await queued()).toEqual([]);
  });
});

describe("get_track_stream", () => {
  it("returns the latest file once its game reached results", async () => {
    const [a, b] = [await createUser(db), await createUser(db)];
    const g = await finishedGame([a, b], { close: false });
    const track = await placeIn(g.subs[a], SHA_A);
    expect(await stream(track)).toMatchObject({ submission_id: g.subs[a], storage_path: await pathOf(g.subs[a]) });
    expect(await streamError(crypto.randomUUID())).toBe("track_not_found");
  });

  it("refuses submissions in live games, blind or not, until results", async () => {
    const [a, b] = [await createUser(db), await createUser(db)];
    const g1 = await finishedGame([a, b]);
    const track = await placeIn(g1.subs[a], SHA_A);

    const roomId = await producingRoom([a, b]);
    const live = await submitVerified(db, a, roomId);
    await submitVerified(db, b, roomId);
    expect(await placeIn(live, SHA_A)).toBe(track);
    expect(await latestOf(track)).toBe(live);

    for (const phase of ["listening", "reviewing"]) {
      expect((await db.query<{ status: string }>("select status from public.rooms where id = $1", [roomId])).rows[0].status).toBe(phase);
      expect(await streamError(track)).toBe("track_not_playable");
      const [listed] = await profileTracks(a);
      expect(listed).toMatchObject({ id: track, playable: false, latest_submission_id: null, duration_ms: null, peaks: null });
      if (phase === "listening") await playThrough(roomId, a, { review: false });
    }

    await endReview(db, roomId);
    expect(await stream(track)).toMatchObject({ submission_id: live });
    expect((await profileTracks(a))[0]).toMatchObject({ playable: true, latest_submission_id: live });
  });

  it("refuses purged files", async () => {
    const [a, b] = [await createUser(db), await createUser(db)];
    const g = await finishedGame([a, b]);
    const track = await placeIn(g.subs[a], SHA_A);
    await service("select public.mark_submissions_purged($1) as result", [[g.subs[a]]]);
    expect(await streamError(track)).toBe("track_not_playable");
  });

  it("rate limits each requester and is service-only", async () => {
    const [a, b] = [await createUser(db), await createUser(db)];
    const g = await finishedGame([a, b]);
    const track = await placeIn(g.subs[a], SHA_A);
    for (let i = 0; i < 30; i++) await stream(track, "ip:abc");
    expect(await streamError(track, "ip:abc")).toBe("stream_rate_limited");
    expect(await stream(track, "ip:other")).toMatchObject({ submission_id: g.subs[a] });
    await db.query("update public.track_stream_requests set created_at = now() - interval '2 minutes'");
    expect(await stream(track, "ip:abc")).toMatchObject({ submission_id: g.subs[a] });
    expect(await streamError(track, " ")).toBe("invalid_request");

    expect(await rpcError(db, a, "get_track_stream", { p_track_id: track, p_requester: "x" })).toMatch(/permission denied/);
    await expect(
      asUser(db, null, async (tx) => {
        await tx.exec("set local role anon");
        return tx.query("select public.get_track_stream($1, 'x')", [track]);
      }),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("peaks", () => {
  const clip = (fn: string, userId: string, roomId: string, peaks: unknown) =>
    rpc(db, userId, fn, { p_room_id: roomId, p_clip_start_ms: 0, p_clip_end_ms: 30_000, p_peaks: peaks });
  const clipError = (userId: string, roomId: string, peaks: unknown) =>
    rpcError(db, userId, "confirm_submission", { p_room_id: roomId, p_clip_start_ms: 0, p_clip_end_ms: 30_000, p_peaks: peaks });
  const peaksOf = async (submissionId: string) =>
    (await db.query<{ peaks: number[] | null }>("select peaks from public.submissions where id = $1", [submissionId])).rows[0].peaks;

  it("accepts exactly 120 values between 0 and 255 with the clip", async () => {
    const [a, b, c] = [await createUser(db), await createUser(db), await createUser(db)];
    const roomId = await producingRoom([a, b, c]);
    const sub = await submitVerified(db, a, roomId, 60_000, { confirm: false });

    for (const bad of [PEAKS.slice(1), [...PEAKS, 0], [...PEAKS.slice(1), 256], [...PEAKS.slice(1), -1], [], [[1, 2]]]) {
      expect(await clipError(a, roomId, bad), JSON.stringify(bad).slice(0, 40)).toBe("invalid_peaks");
    }
    expect(await peaksOf(sub)).toBeNull();

    await clip("set_submission_clip", a, roomId, PEAKS);
    expect(await peaksOf(sub)).toEqual(PEAKS);
    await clip("confirm_submission", a, roomId, null);
    expect(await peaksOf(sub)).toEqual(PEAKS);
    const louder = PEAKS.map((p) => Math.min(255, p + 1));
    await clip("confirm_submission", a, roomId, louder);
    expect(await peaksOf(sub)).toEqual(louder);
    await expect(db.query("update public.submissions set peaks = '{1,2,3}' where id = $1", [sub])).rejects.toThrow(
      /submissions_peaks_valid/,
    );
  });

  it("are cleared when the file is replaced and shown on profiles", async () => {
    const [a, b, c] = [await createUser(db), await createUser(db), await createUser(db)];
    const roomId = await producingRoom([a, b, c]);
    const sub = await submitVerified(db, a, roomId, 60_000, { confirm: false });
    await clip("set_submission_clip", a, roomId, PEAKS);
    const { uploadId } = await verifiedUpload(db, a, roomId, 50_000);
    await rpc(db, a, "submit_track", { p_room_id: roomId, p_upload_id: uploadId });
    expect(await peaksOf(sub)).toBeNull();

    await clip("confirm_submission", a, roomId, PEAKS);
    await submitVerified(db, b, roomId);
    await submitVerified(db, c, roomId);
    await playThrough(roomId, a);
    const track = await placeIn(sub, SHA_A);
    expect((await profileTracks(a)).find((t) => t.id === track)).toMatchObject({
      playable: true,
      latest_submission_id: sub,
      duration_ms: 50_000,
      clip_start_ms: 0,
      clip_end_ms: 30_000,
      peaks: PEAKS,
    });
  });
});
