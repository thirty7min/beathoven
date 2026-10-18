import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, createUser, rpc, rpcError, submitVerified, verifiedUpload, endReview, type TestDb } from "./harness";

type Clip = { clip_start_ms: number; clip_end_ms: number };
type State = {
  room: { status: string; track_order: string[]; current_track: number | null; track_started_at: string | null; phase_ends_at: string };
  submitted_user_ids: string[];
  submissions: ({ id: string; duration_ms: number } & Clip)[];
  results: ({ submission_id: string } & Clip)[];
  my_submission: ({ id: string; confirmed: boolean } & Clip) | null;
};

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});

const snapshot = (userId: string, roomId: string) => rpc<State>(db, userId, "get_room_snapshot", { p_room_id: roomId });

async function producingRoom(n = 2, settings: Record<string, unknown> = {}) {
  const players = await Promise.all(Array.from({ length: n }, () => createUser(db)));
  const room = await rpc<{ room_id: string; code: string }>(db, players[0], "create_room", { p_mode: "creative", ...settings });
  for (const p of players.slice(1)) await rpc(db, p, "join_room", { p_code: room.code });
  await db.query("update public.room_players set is_ready = true where room_id = $1", [room.room_id]);
  await rpc(db, players[0], "start_game", { p_room_id: room.room_id });
  return { players, roomId: room.room_id };
}

const draft = (userId: string, roomId: string, durationMs = 120_000) =>
  submitVerified(db, userId, roomId, durationMs, { confirm: false });

const confirm = (userId: string, roomId: string, start: number, end: number) =>
  rpc<{ confirmed: boolean } & Clip>(db, userId, "confirm_submission", { p_room_id: roomId, p_clip_start_ms: start, p_clip_end_ms: end });

const setClip = (userId: string, roomId: string, start: number, end: number) =>
  rpc(db, userId, "set_submission_clip", { p_room_id: roomId, p_clip_start_ms: start, p_clip_end_ms: end });

const clipError = (userId: string, roomId: string, start: number | null, end: number | null) =>
  rpcError(db, userId, "confirm_submission", { p_room_id: roomId, p_clip_start_ms: start, p_clip_end_ms: end });

async function expirePhase(roomId: string) {
  await db.query("update public.rooms set phase_ends_at = now() - interval '2 seconds' where id = $1", [roomId]);
  await db.query("select public.sweep_rooms()");
}

const scheduledMs = (s: State) => Date.parse(s.room.phase_ends_at) - Date.parse(s.room.track_started_at!);

describe("drafts and confirmation", () => {
  it("counts only confirmed submissions towards an early start", async () => {
    const { players, roomId } = await producingRoom(2);
    await draft(players[0], roomId);
    await draft(players[1], roomId);
    let s = await snapshot(players[0], roomId);
    expect(s.room.status).toBe("producing");
    expect(s.submitted_user_ids).toEqual([]);
    expect(s.my_submission).toMatchObject({ confirmed: false, clip_start_ms: 0, clip_end_ms: 45_000 });

    await confirm(players[0], roomId, 0, 45_000);
    s = await snapshot(players[1], roomId);
    expect(s.room.status).toBe("producing");
    expect(s.submitted_user_ids).toEqual([players[0]]);

    await confirm(players[1], roomId, 10_000, 40_000);
    expect((await snapshot(players[0], roomId)).room.status).toBe("listening");
  });

  it("lets a confirmed clip be adjusted and a draft clip be saved without confirming", async () => {
    const { players, roomId } = await producingRoom(3);
    await draft(players[0], roomId);
    await setClip(players[0], roomId, 5_000, 35_000);
    expect((await snapshot(players[0], roomId)).my_submission).toMatchObject({
      confirmed: false,
      clip_start_ms: 5_000,
      clip_end_ms: 35_000,
    });
    expect(await confirm(players[0], roomId, 20_000, 60_000)).toMatchObject({ confirmed: true, clip_start_ms: 20_000 });
    await setClip(players[0], roomId, 30_000, 60_000);
    expect((await snapshot(players[0], roomId)).my_submission).toMatchObject({ confirmed: true, clip_start_ms: 30_000 });
    expect(await confirm(players[0], roomId, 0, 30_000)).toMatchObject({ confirmed: true, clip_end_ms: 30_000 });
  });

  it("resets a replaced submission to a draft with the default clip", async () => {
    const { players, roomId } = await producingRoom(3);
    await draft(players[0], roomId);
    await confirm(players[0], roomId, 50_000, 90_000);
    const { uploadId } = await verifiedUpload(db, players[0], roomId, 20_000);
    await rpc(db, players[0], "submit_track", { p_room_id: roomId, p_upload_id: uploadId });
    const s = await snapshot(players[0], roomId);
    expect(s.my_submission).toMatchObject({ confirmed: false, clip_start_ms: 0, clip_end_ms: 20_000 });
    expect(s.submitted_user_ids).toEqual([]);
  });

  it("validates the clip bounds", async () => {
    const { players, roomId } = await producingRoom(3);
    expect(await clipError(players[0], roomId, 0, 30_000)).toBe("upload_missing");
    await draft(players[0], roomId, 120_000);
    for (const [start, end] of [
      [-1, 30_000],
      [100_000, 120_001],
      [30_000, 30_000],
      [40_000, 30_000],
      [0, 45_001],
      [0, 9_999],
      [null, 30_000],
      [0, null],
    ]) {
      expect(await clipError(players[0], roomId, start, end), `${start}-${end}`).toBe("invalid_clip");
    }
    expect(await confirm(players[0], roomId, 75_000, 120_000)).toMatchObject({ clip_start_ms: 75_000, clip_end_ms: 120_000 });
    expect(await confirm(players[0], roomId, 0, 10_000)).toMatchObject({ clip_end_ms: 10_000 });

    await draft(players[1], roomId, 6_000);
    expect(await clipError(players[1], roomId, 0, 5_000)).toBe("invalid_clip");
    expect(await confirm(players[1], roomId, 0, 6_000)).toMatchObject({ clip_end_ms: 6_000 });
  });

  it("caps the clip at the room's listen time", async () => {
    const { players, roomId } = await producingRoom(2, { p_listen_seconds: 30 });
    await draft(players[0], roomId);
    expect(await clipError(players[0], roomId, 0, 31_000)).toBe("invalid_clip");
    expect(await confirm(players[0], roomId, 60_000, 90_000)).toMatchObject({ clip_start_ms: 60_000 });
  });

  it("locks clips at the deadline and outside producing", async () => {
    const { players, roomId } = await producingRoom(3);
    await draft(players[0], roomId);
    await db.query("update public.rooms set phase_ends_at = now() - interval '1 second' where id = $1", [roomId]);
    expect(await clipError(players[0], roomId, 0, 30_000)).toBe("deadline_passed");
    await db.query("select public.sweep_rooms()");
    expect(await clipError(players[0], roomId, 0, 30_000)).toBe("wrong_phase");
  });
});

describe("deadline auto-confirm and schedule", () => {
  it("confirms drafts at the deadline with their saved or default clip", async () => {
    const { players, roomId } = await producingRoom(3);
    const saved = await draft(players[0], roomId, 120_000);
    await setClip(players[0], roomId, 30_000, 50_000);
    const untouched = await draft(players[1], roomId, 25_000);
    await expirePhase(roomId);

    const { rows } = await db.query<{ id: string; confirmed: boolean } & Clip>(
      "select id, confirmed, clip_start_ms, clip_end_ms from public.submissions where room_id = $1 order by duration_ms desc",
      [roomId],
    );
    expect(rows).toEqual([
      { id: saved, confirmed: true, clip_start_ms: 30_000, clip_end_ms: 50_000 },
      { id: untouched, confirmed: true, clip_start_ms: 0, clip_end_ms: 25_000 },
    ]);

    const s = await snapshot(players[2], roomId);
    expect(s.room.status).toBe("listening");
    const current = s.submissions.find((x) => x.id === s.room.track_order[s.room.current_track!])!;
    expect(scheduledMs(s)).toBe(current.clip_end_ms - current.clip_start_ms);
    expect(s.submissions.map((x) => [x.clip_start_ms, x.clip_end_ms]).sort()).toEqual([
      [0, 25_000],
      [30_000, 50_000],
    ]);
  });

  it("plays each track for its clip length and returns clips in results", async () => {
    const { players, roomId } = await producingRoom(2);
    await draft(players[0], roomId, 120_000);
    await draft(players[1], roomId, 120_000);
    await confirm(players[0], roomId, 60_000, 72_000);
    await confirm(players[1], roomId, 0, 45_000);

    const lengths: number[] = [];
    for (let i = 0; i < 2; i++) {
      const s = await snapshot(players[0], roomId);
      lengths.push(scheduledMs(s));
      await db.query(
        "update public.rooms set track_started_at = now() - interval '1 hour', phase_ends_at = now() - interval '2 seconds' where id = $1",
        [roomId],
      );
      await rpc(db, players[0], "advance_room", { p_room_id: roomId });
    }
    expect(lengths.sort((a, b) => a - b)).toEqual([12_000, 45_000]);
    await endReview(db, roomId);

    const s = await snapshot(players[0], roomId);
    expect(s.room.status).toBe("results");
    expect(s.results.map((r) => [r.clip_start_ms, r.clip_end_ms]).sort()).toEqual([
      [0, 45_000],
      [60_000, 72_000],
    ]);
  });

  it("closes voting at the end of the clip", async () => {
    const { players, roomId } = await producingRoom(2);
    await draft(players[0], roomId, 120_000);
    await draft(players[1], roomId, 120_000);
    await confirm(players[0], roomId, 0, 12_000);
    await confirm(players[1], roomId, 0, 12_000);
    const s = await snapshot(players[0], roomId);
    const current = s.room.track_order[0];
    const { rows } = await db.query<{ user_id: string }>("select user_id from public.submissions where id = $1", [current]);
    const voter = players.find((p) => p !== rows[0].user_id)!;
    await db.query("update public.rooms set track_started_at = now() - interval '14 seconds' where id = $1", [roomId]);
    expect(
      await rpcError(db, voter, "cast_vote", { p_room_id: roomId, p_submission_id: current, p_score: 4 }),
    ).toBe("deadline_passed");
  });
});

describe("bots", () => {
  it("confirm immediately with the default clip", async () => {
    await db.query("update public.app_config set dev_tools_enabled = true");
    const host = await createUser(db);
    const botUser = await createUser(db);
    await db.transaction(async (tx) => {
      await tx.exec("set local role service_role");
      await tx.query("select public.dev_register_bot($1, 'bots/clip.wav', 50000)", [botUser]);
    });
    const room = await rpc<{ room_id: string }>(db, host, "create_room", { p_mode: "creative", p_listen_seconds: 30 });
    await rpc(db, host, "dev_add_bot", { p_room_id: room.room_id });
    await rpc(db, host, "start_game", { p_room_id: room.room_id, p_force: true });
    const { rows } = await db.query<{ confirmed: boolean } & Clip>(
      "select confirmed, clip_start_ms, clip_end_ms from public.submissions where room_id = $1",
      [room.room_id],
    );
    expect(rows).toEqual([{ confirmed: true, clip_start_ms: 0, clip_end_ms: 30_000 }]);
    expect((await snapshot(host, room.room_id)).submitted_user_ids).toHaveLength(1);
  });
});
