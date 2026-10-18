import { beforeEach, describe, expect, it } from "vitest";
import { asService, createTestDb, createUser, endReview, rpc, rpcError, submitVerified, verifiedUpload, type TestDb } from "./harness";

type Loudness = { loudness_lufs: number | null; true_peak_dbtp: number | null; loudness_boost: boolean };
type State = {
  room: { status: string; track_order: string[] };
  submissions: ({ id: string } & Loudness)[];
  results: ({ submission_id: string } & Loudness)[];
  my_submission: ({ id: string } & Loudness) | null;
  my_review: ({ submission_id: string } & Loudness)[] | null;
};

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});

const snapshot = (userId: string, roomId: string) => rpc<State>(db, userId, "get_room_snapshot", { p_room_id: roomId });

const service = <T>(sql: string, params: unknown[] = []) =>
  asService(db, async (tx) => (await tx.query<{ result: T }>(sql, params)).rows[0]?.result);

const row = async (submissionId: string) =>
  (
    await db.query<Loudness & { loudness_status: string; loudness_attempts: number; storage_path: string }>(
      "select loudness_lufs, true_peak_dbtp, loudness_boost, loudness_status, loudness_attempts, storage_path from public.submissions where id = $1",
      [submissionId],
    )
  ).rows[0];

const record = async (submissionId: string, ok: boolean, lufs: number | null = null, peak: number | null = null, path?: string) =>
  service<boolean>("select public.record_submission_loudness($1, $2, $3, $4, $5) as result", [
    submissionId,
    path ?? (await row(submissionId)).storage_path,
    ok,
    lufs,
    peak,
  ]);

const candidates = () =>
  asService(db, async (tx) =>
    (await tx.query<{ submission_id: string }>("select * from public.loudness_retry_candidates(10)")).rows.map((r) => r.submission_id),
  );

async function producingRoom(n = 3) {
  const players = await Promise.all(Array.from({ length: n }, () => createUser(db)));
  const room = await rpc<{ room_id: string; code: string }>(db, players[0], "create_room", { p_mode: "creative" });
  for (const p of players.slice(1)) await rpc(db, p, "join_room", { p_code: room.code });
  await db.query("update public.room_players set is_ready = true where room_id = $1", [room.room_id]);
  await rpc(db, players[0], "start_game", { p_room_id: room.room_id });
  return { players, roomId: room.room_id };
}

const clip = (fn: string, userId: string, roomId: string, boost: boolean | null) =>
  rpc<{ loudness_boost: boolean }>(db, userId, fn, { p_room_id: roomId, p_clip_start_ms: 0, p_clip_end_ms: 30_000, p_loudness_boost: boost });

describe("loudness measurement", () => {
  it("starts pending and records a measurement only for the current file", async () => {
    const { players, roomId } = await producingRoom();
    const sub = await submitVerified(db, players[0], roomId, 60_000, { confirm: false });
    expect(await row(sub)).toMatchObject({ loudness_lufs: null, true_peak_dbtp: null, loudness_boost: true, loudness_status: "pending" });

    expect(await record(sub, true, -9, -0.3, "elsewhere.mp3")).toBe(false);
    expect(await record(sub, true, -18.25, -2.5)).toBe(true);
    expect(await row(sub)).toMatchObject({ loudness_lufs: -18.25, true_peak_dbtp: -2.5, loudness_status: "done" });
    expect((await snapshot(players[0], roomId)).my_submission).toMatchObject({
      loudness_lufs: -18.25,
      true_peak_dbtp: -2.5,
      loudness_boost: true,
    });
  });

  it("keeps out-of-range values out and gives up after three failures", async () => {
    const { players, roomId } = await producingRoom();
    const odd = await submitVerified(db, players[0], roomId, 60_000, { confirm: false });
    await record(odd, true, 500, -1000);
    expect(await row(odd)).toMatchObject({ loudness_lufs: null, true_peak_dbtp: null, loudness_status: "done" });

    const broken = await submitVerified(db, players[1], roomId, 60_000, { confirm: false });
    await record(broken, false);
    await record(broken, false);
    expect(await row(broken)).toMatchObject({ loudness_status: "pending", loudness_attempts: 2 });
    await record(broken, false);
    expect(await row(broken)).toMatchObject({ loudness_status: "failed", loudness_attempts: 3 });
  });

  it("offers pending, unpurged, non-bot files to the cron retry after a grace period", async () => {
    const { players, roomId } = await producingRoom();
    const pending = await submitVerified(db, players[0], roomId, 60_000, { confirm: false });
    const done = await submitVerified(db, players[1], roomId, 60_000, { confirm: false });
    const purged = await submitVerified(db, players[2], roomId, 60_000, { confirm: false });
    await record(done, true, -14, -1);
    expect(await candidates()).toEqual([]);
    await db.query("update public.submissions set submitted_at = now() - interval '5 minutes'");
    await service("select public.mark_submissions_purged($1) as result", [[purged]]);
    expect(await candidates()).toEqual([pending]);
  });

  it("bumps the room while producing so the uploader sees the result at once", async () => {
    const { players, roomId } = await producingRoom();
    const sub = await submitVerified(db, players[0], roomId, 60_000, { confirm: false });
    const version = async () =>
      (await db.query<{ version: number }>("select version from public.rooms where id = $1", [roomId])).rows[0].version;

    const before = await version();
    expect(await record(sub, true, -9, -0.3, "elsewhere.mp3")).toBe(false);
    await record(sub, false);
    expect(await version()).toBe(before);
    await record(sub, true, -18, -3);
    expect(await version()).toBe(before + 1);
    const { rows } = await db.query<{ payload: { version: number } }>(
      "select payload from realtime.messages where event = 'room_state' order by id desc limit 1",
    );
    expect(rows[0].payload.version).toBe(before + 1);

    await db.query("update public.rooms set status = 'listening' where id = $1", [roomId]);
    const listening = await version();
    await record(sub, true, -17, -2);
    expect(await version()).toBe(listening);
    expect((await row(sub)).loudness_lufs).toBe(-17);
  });

  it("is service-only", async () => {
    const { players, roomId } = await producingRoom();
    const sub = await submitVerified(db, players[0], roomId, 60_000, { confirm: false });
    expect(
      await rpcError(db, players[0], "record_submission_loudness", { p_submission_id: sub, p_storage_path: "x", p_ok: true, p_lufs: -14 }),
    ).toMatch(/permission denied/);
    expect(await rpcError(db, players[0], "loudness_retry_candidates")).toMatch(/permission denied/);
  });
});

describe("loudness boost toggle", () => {
  it("is on by default, set with the clip, kept when omitted and reset when the file is replaced", async () => {
    const { players, roomId } = await producingRoom();
    const sub = await submitVerified(db, players[0], roomId, 60_000, { confirm: false });
    expect(await clip("set_submission_clip", players[0], roomId, false)).toMatchObject({ loudness_boost: false });
    expect((await row(sub)).loudness_boost).toBe(false);
    expect(await clip("confirm_submission", players[0], roomId, null)).toMatchObject({ loudness_boost: false });
    expect(await clip("confirm_submission", players[0], roomId, true)).toMatchObject({ loudness_boost: true });
    await clip("set_submission_clip", players[0], roomId, false);
    await record(sub, true, -20, -6);

    const { uploadId } = await verifiedUpload(db, players[0], roomId, 50_000);
    await rpc(db, players[0], "submit_track", { p_room_id: roomId, p_upload_id: uploadId });
    expect(await row(sub)).toMatchObject({
      loudness_boost: true,
      loudness_lufs: null,
      true_peak_dbtp: null,
      loudness_status: "pending",
      loudness_attempts: 0,
    });
  });

  it("locks with the clip at the deadline", async () => {
    const { players, roomId } = await producingRoom();
    await submitVerified(db, players[0], roomId, 60_000, { confirm: false });
    await db.query("update public.rooms set phase_ends_at = now() - interval '1 second' where id = $1", [roomId]);
    expect(
      await rpcError(db, players[0], "set_submission_clip", { p_room_id: roomId, p_clip_start_ms: 0, p_clip_end_ms: 30_000, p_loudness_boost: false }),
    ).toBe("deadline_passed");
  });

  it("is off for bots", async () => {
    await db.query("update public.app_config set dev_tools_enabled = true");
    const host = await createUser(db);
    const bot = await createUser(db);
    await asService(db, (tx) => tx.query("select public.dev_register_bot($1, 'bots/loud.wav', 40000)", [bot]));
    const room = await rpc<{ room_id: string }>(db, host, "create_room", { p_mode: "creative" });
    await rpc(db, host, "dev_add_bot", { p_room_id: room.room_id });
    await rpc(db, host, "start_game", { p_room_id: room.room_id, p_force: true });
    const { rows } = await db.query<{ loudness_boost: boolean; loudness_status: string }>(
      "select loudness_boost, loudness_status from public.submissions where user_id = $1",
      [bot],
    );
    expect(rows).toEqual([{ loudness_boost: false, loudness_status: "failed" }]);
  });
});

describe("loudness in playback data", () => {
  it("is exposed while listening, in review, in results, on profiles and in the stream info", async () => {
    const { players, roomId } = await producingRoom(2);
    const [a, b] = players;
    const subA = await submitVerified(db, a, roomId, 60_000, { confirm: false });
    await clip("confirm_submission", a, roomId, false);
    const subB = await submitVerified(db, b, roomId);
    await record(subA, true, -22.5, -7.25);
    await record(subB, true, -9.5, 0.4);
    const expectA = { loudness_lufs: -22.5, true_peak_dbtp: -7.25, loudness_boost: false };
    const expectB = { loudness_lufs: -9.5, true_peak_dbtp: 0.4, loudness_boost: true };

    let s = await snapshot(a, roomId);
    expect(s.room.status).toBe("listening");
    expect(s.submissions.find((x) => x.id === subA)).toMatchObject(expectA);
    expect(s.submissions.find((x) => x.id === subB)).toMatchObject(expectB);

    for (let i = 0; i < 2; i++) {
      await db.query(
        "update public.rooms set track_started_at = now() - interval '1 hour', phase_ends_at = now() - interval '2 seconds' where id = $1",
        [roomId],
      );
      await rpc(db, a, "advance_room", { p_room_id: roomId });
    }
    s = await snapshot(a, roomId);
    expect(s.room.status).toBe("reviewing");
    expect(s.my_review!.find((x) => x.submission_id === subB)).toMatchObject(expectB);

    await endReview(db, roomId);
    s = await snapshot(a, roomId);
    expect(s.results.find((x) => x.submission_id === subA)).toMatchObject(expectA);

    const path = (await row(subA)).storage_path;
    await service("select public.register_submission_audio($1, $2, $3, 'Quiet one') as result", [subA, path, "c".repeat(64)]);
    const assigned = await service<{ track_id: string }>(
      "select public.assign_submission_track($1, $2, null, 'failed', null, null, null, null) as result",
      [subA, path],
    );
    const { rows } = await db.query<{ username: string }>("select username from public.profiles where id = $1", [a]);
    const tracks = await rpc<({ id: string } & Loudness)[]>(db, null, "get_profile_tracks", { p_username: rows[0].username });
    expect(tracks.find((t) => t.id === assigned.track_id)).toMatchObject(expectA);
    expect(await service("select public.get_track_stream($1, 'user:test') as result", [assigned.track_id])).toMatchObject(expectA);
  });
});
