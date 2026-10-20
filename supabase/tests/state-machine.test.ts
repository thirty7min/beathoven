import { beforeEach, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, rpc, rpcError, submitVerified, verifiedUpload, endReview, type TestDb } from "./harness";

type RoomRef = { room_id: string; code: string; version: number };

type State = {
  version: number;
  room: {
    id: string;
    name: string;
    mode: string;
    is_private: boolean;
    reveal_names: boolean;
    listen_seconds: number;
    produce_seconds: number;
    host_id: string | null;
    status: string;
    round: number;
    phase_ends_at: string | null;
    track_order: string[];
    current_track: number | null;
    track_started_at: string | null;
  };
  players: { user_id: string; left_at: string | null; last_seen_at: string; is_ready: boolean; role: string }[];
  assets: { kind: string; position: number; prompt: string | null; sample: { id: number; category: string } | null }[];
  readiness: { ready: number; total: number; all_ready: boolean; can_start: boolean };
  submissions: { id: string; user_id: string | null; storage_path: string; duration_ms: number; submitted_at: string | null }[];
  submitted_user_ids: string[];
  current_votes: { submission_id: string; count: number; eligible: number; voted_user_ids?: string[] } | null;
  skip: { submission_id: string; votes: number; needed: number; you_voted?: boolean } | null;
  my_submission: { id: string; user_id: string; storage_path: string; duration_ms: number } | null;
  my_skip_votes: string[];
  votes_cast: { submission_id: string; voter_id: string }[];
  results: { user_id: string; avg_score: number | null; vote_count: number; rank: number; is_winner: boolean }[];
  my_votes: { submission_id: string; score: number }[];
  chat: { body: string }[];
};

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});

const users = (n: number) => Promise.all(Array.from({ length: n }, () => createUser(db)));

const snapshot = (userId: string, roomId: string) =>
  rpc<State>(db, userId, "get_room_snapshot", { p_room_id: roomId });

async function createRoom(host: string, settings: Record<string, unknown> = {}) {
  return rpc<RoomRef>(db, host, "create_room", { p_mode: "creative", ...settings });
}

async function roomWith(n: number, settings: Record<string, unknown> = {}) {
  const players = await users(n);
  const room = await createRoom(players[0], settings);
  for (const p of players.slice(1)) await rpc(db, p, "join_room", { p_code: room.code });
  return { players, roomId: room.room_id, code: room.code };
}

async function readyAll(roomId: string) {
  await db.query("update public.room_players set is_ready = true where room_id = $1 and left_at is null", [roomId]);
}

async function startGame(host: string, roomId: string) {
  await readyAll(roomId);
  await rpc(db, host, "start_game", { p_room_id: roomId });
}

const submit = (userId: string, roomId: string, durationMs = 60000) => submitVerified(db, userId, roomId, durationMs);

async function beginPlayback(roomId: string) {
  await db.query(
    "update public.rooms set track_started_at = now() - interval '1 second' where id = $1 and track_started_at > now()",
    [roomId],
  );
}

const vote = async (voter: string, roomId: string, submissionId: string, score: number) => {
  await beginPlayback(roomId);
  return rpc(db, voter, "cast_vote", { p_room_id: roomId, p_submission_id: submissionId, p_score: score });
};

const withoutHeartbeat = (players: State["players"]) =>
  players.map((p) => {
    const rest: Partial<State["players"][number]> = { ...p };
    delete rest.last_seen_at;
    return rest;
  });

async function expirePhase(roomId: string) {
  await db.query("update public.rooms set phase_ends_at = now() - interval '2 seconds' where id = $1", [roomId]);
}

async function finishTrackPlayback(roomId: string) {
  await db.query(
    "update public.rooms set track_started_at = now() - interval '1 hour', phase_ends_at = now() - interval '2 seconds' where id = $1",
    [roomId],
  );
}

const currentTrack = (s: State) => s.room.track_order[s.room.current_track ?? -1];
async function ownerOf(submissionId: string) {
  const { rows } = await db.query<{ user_id: string }>("select user_id from public.submissions where id = $1", [
    submissionId,
  ]);
  return rows[0].user_id;
}

async function broadcasts(roomId: string, event: string) {
  const { rows } = await db.query<{ payload: { version: number } & Record<string, unknown> }>(
    "select payload from realtime.messages where topic = $1 and event = $2 order by id",
    [`room:${roomId}`, event],
  );
  return rows.map((r) => r.payload);
}

describe("create / join / capacity", () => {
  it("requires auth", async () => {
    expect(await rpcError(db, null, "create_room", { p_mode: "creative" })).toBe("not_authenticated");
  });

  it("rejects invalid mode and settings", async () => {
    const [a] = await users(1);
    expect(await rpcError(db, a, "create_room", { p_mode: "freestyle" })).toBe("invalid_mode");
    expect(await rpcError(db, a, "create_room", { p_mode: "classic", p_max_players: 1 })).toBe("invalid_settings");
  });

  it("creates a room with the creator as host and only member", async () => {
    const [a, b] = await users(2);
    const room = await createRoom(a);
    expect(room.code).toMatch(/^[A-Z0-9]{6}$/);
    const s = await snapshot(a, room.room_id);
    expect(s.room.host_id).toBe(a);
    expect(s.room.status).toBe("lobby");
    expect(s.players.map((p) => p.user_id)).toEqual([a]);
    expect(await rpcError(db, b, "get_room_snapshot", { p_room_id: room.room_id })).toBe("not_member");
  });

  it("joins by code case-insensitively, idempotently, and respects capacity", async () => {
    const [a, b, c] = await users(3);
    const room = await createRoom(a, { p_max_players: 2 });
    const joined = await rpc<RoomRef>(db, b, "join_room", { p_code: ` ${room.code.toLowerCase()} ` });
    expect(joined.room_id).toBe(room.room_id);
    const again = await rpc<RoomRef>(db, b, "join_room", { p_code: room.code });
    expect(again.version).toBe(joined.version);
    expect(await rpc<RoomRef & { role: string }>(db, c, "join_room", { p_code: room.code })).toMatchObject({ role: "spectator" });
    expect(await rpcError(db, c, "join_room", { p_code: "ZZZZZZ" })).toBe("room_not_found");

    await rpc(db, b, "leave_room", { p_room_id: room.room_id });
    expect((await snapshot(a, room.room_id)).players.find((p) => p.user_id === c)).toMatchObject({ role: "player", left_at: null });
    expect(await rpc<RoomRef & { role: string }>(db, b, "join_room", { p_code: room.code })).toMatchObject({ role: "spectator" });
  });

  it("seats newcomers as spectators once the game has started", async () => {
    const { players, roomId, code } = await roomWith(2);
    const [outsider, late] = await users(2);
    await startGame(players[0], roomId);
    expect(await rpc<RoomRef & { role: string }>(db, outsider, "join_room", { p_code: code })).toMatchObject({ role: "spectator" });
    await expirePhase(roomId);
    await rpc(db, players[0], "advance_room", { p_room_id: roomId });
    expect((await snapshot(players[0], roomId)).room.status).toBe("results");
    expect(await rpc<RoomRef & { role: string }>(db, late, "join_room", { p_code: code })).toMatchObject({ role: "spectator" });
  });

  it("lets an active member re-join mid-game as a no-op", async () => {
    const { players, roomId, code } = await roomWith(2);
    await startGame(players[0], roomId);
    const before = await snapshot(players[1], roomId);
    const again = await rpc<RoomRef>(db, players[1], "join_room", { p_code: code });
    expect(again).toEqual({ room_id: roomId, code, version: before.version, role: "player" });
    expect(withoutHeartbeat((await snapshot(players[1], roomId)).players)).toEqual(withoutHeartbeat(before.players));
  });

  it("lets a player who left mid-game watch, then plays again back in the lobby", async () => {
    const { players, roomId, code } = await roomWith(3);
    const [outsider] = await users(1);
    await startGame(players[0], roomId);
    await rpc(db, players[1], "room_heartbeat");
    await rpc(db, players[2], "leave_room", { p_room_id: roomId });
    await expirePhase(roomId);
    await rpc(db, players[0], "advance_room", { p_room_id: roomId });
    expect(await rpc<RoomRef & { role: string }>(db, players[2], "join_room", { p_code: code })).toMatchObject({ role: "spectator" });

    await expirePhase(roomId);
    await rpc(db, players[0], "advance_room", { p_room_id: roomId });
    expect((await snapshot(players[0], roomId)).room.status).toBe("lobby");

    await rpc(db, players[2], "join_room", { p_code: code });
    await rpc(db, outsider, "join_room", { p_code: code });
    const active = (await snapshot(players[0], roomId)).players.filter((p) => p.left_at === null);
    expect(active.map((p) => p.user_id).sort()).toEqual([players[0], players[1], players[2], outsider].sort());
    expect(active.every((p) => p.role === "player")).toBe(true);
  });

  it("lets a player rejoin after leaving", async () => {
    const { players, roomId, code } = await roomWith(3);
    await rpc(db, players[2], "leave_room", { p_room_id: roomId });
    expect(await rpcError(db, players[2], "send_chat", { p_room_id: roomId, p_body: "hi" })).toBe("not_member");
    await rpc(db, players[2], "join_room", { p_code: code });
    const s = await snapshot(players[2], roomId);
    expect(s.players.find((p) => p.user_id === players[2])!.left_at).toBeNull();
  });

  it("joining another room leaves the previous one and hands off its host", async () => {
    const roomA = await roomWith(2);
    const [hostA, memberA] = roomA.players;
    const [hostB] = await users(1);
    const roomB = await createRoom(hostB);
    const versionA = (await snapshot(memberA, roomA.roomId)).version;

    await rpc(db, hostA, "join_room", { p_code: roomB.code });

    const a = await snapshot(memberA, roomA.roomId);
    expect(a.room.host_id).toBe(memberA);
    expect(a.players.find((p) => p.user_id === hostA)!.left_at).not.toBeNull();
    expect(a.version).toBe(versionA + 1);
    expect((await snapshot(hostA, roomB.room_id)).players.map((p) => p.user_id)).toEqual([hostB, hostA]);
    const { rows } = await db.query("select room_id from public.room_players where user_id = $1 and left_at is null", [
      hostA,
    ]);
    expect(rows).toEqual([{ room_id: roomB.room_id }]);
    expect((await broadcasts(roomA.roomId, "room_state")).at(-1)!.version).toBe(versionA + 1);
  });

  it("creating a room leaves the previous one, closing it when empty", async () => {
    const [a] = await users(1);
    const first = await createRoom(a);
    const second = await createRoom(a);
    expect((await snapshot(a, first.room_id)).room.status).toBe("closed");
    expect((await snapshot(a, second.room_id)).players.map((p) => p.user_id)).toEqual([a]);
  });

  it("spectates a full room, leaving the previous one", async () => {
    const roomA = await roomWith(2);
    const roomB = await roomWith(2, { p_max_players: 2 });
    expect(await rpc<RoomRef & { role: string }>(db, roomA.players[1], "join_room", { p_code: roomB.code })).toMatchObject({ role: "spectator" });
    expect((await snapshot(roomA.players[0], roomA.roomId)).players.find((p) => p.user_id === roomA.players[1])!.left_at).not.toBeNull();
  });

  it("rejoining the current room is a no-op", async () => {
    const { players, roomId, code } = await roomWith(2);
    const before = await snapshot(players[1], roomId);
    const again = await rpc<RoomRef>(db, players[1], "join_room", { p_code: code });
    expect(again.version).toBe(before.version);
    expect(withoutHeartbeat((await snapshot(players[1], roomId)).players)).toEqual(withoutHeartbeat(before.players));
  });

  it("enforces one active room per player in the schema", async () => {
    const roomA = await roomWith(1);
    const roomB = await roomWith(1);
    await expect(
      db.query("insert into public.room_players (room_id, user_id) values ($1, $2)", [roomB.roomId, roomA.players[0]]),
    ).rejects.toThrow(/room_players_one_active_room/);
  });
});

describe("lobby", () => {
  it("toggles ready only in lobby", async () => {
    const { players, roomId } = await roomWith(2);
    await rpc(db, players[1], "set_ready", { p_room_id: roomId, p_ready: true });
    expect((await snapshot(players[0], roomId)).players.find((p) => p.user_id === players[1])!.is_ready).toBe(true);
    await startGame(players[0], roomId);
    expect(await rpcError(db, players[1], "set_ready", { p_room_id: roomId, p_ready: true })).toBe("wrong_phase");
  });

  it("only the host starts, with at least two players", async () => {
    const [a, b] = await users(2);
    const room = await createRoom(a);
    expect(await rpcError(db, a, "start_game", { p_room_id: room.room_id })).toBe("not_enough_players");
    await rpc(db, b, "join_room", { p_code: room.code });
    expect(await rpcError(db, b, "start_game", { p_room_id: room.room_id })).toBe("not_host");
    await startGame(a, room.room_id);
    const s = await snapshot(a, room.room_id);
    expect(s.room.status).toBe("producing");
    expect(s.room.round).toBe(1);
    expect(s.assets).toHaveLength(1);
    expect(s.assets[0].kind).toBe("prompt");
    expect(s.assets[0].prompt).toBeTruthy();
    const endsInSeconds = (Date.parse(s.room.phase_ends_at!) - Date.now()) / 1000;
    expect(endsInSeconds).toBeGreaterThan(1200);
    expect(endsInSeconds).toBeLessThanOrEqual(1215);
    expect(await rpcError(db, a, "start_game", { p_room_id: room.room_id })).toBe("wrong_phase");
  });

  it("requires every player, the host included, to be ready unless forced", async () => {
    const { players, roomId } = await roomWith(3);
    const [host, b, c] = players;
    expect((await snapshot(host, roomId)).readiness).toEqual({ ready: 0, total: 3, all_ready: false, can_start: false });

    await rpc(db, b, "set_ready", { p_room_id: roomId, p_ready: true });
    expect(await rpcError(db, host, "start_game", { p_room_id: roomId })).toBe("not_all_ready");
    await rpc(db, c, "set_ready", { p_room_id: roomId, p_ready: true });
    expect(await rpcError(db, host, "start_game", { p_room_id: roomId })).toBe("not_all_ready");
    await rpc(db, host, "set_ready", { p_room_id: roomId, p_ready: true });
    expect((await snapshot(host, roomId)).readiness).toEqual({ ready: 3, total: 3, all_ready: true, can_start: true });
    await rpc(db, host, "start_game", { p_room_id: roomId });
    expect((await snapshot(host, roomId)).room.status).toBe("producing");
  });

  it("lets the host force a start with unready players, but not alone", async () => {
    const { players, roomId } = await roomWith(2);
    expect(await rpcError(db, players[1], "start_game", { p_room_id: roomId, p_force: true })).toBe("not_host");
    await rpc(db, players[0], "start_game", { p_room_id: roomId, p_force: true });
    expect((await snapshot(players[0], roomId)).room.status).toBe("producing");

    const [solo] = await users(1);
    const room = await createRoom(solo);
    expect((await snapshot(solo, room.room_id)).readiness.can_start).toBe(false);
    expect(await rpcError(db, solo, "start_game", { p_room_id: room.room_id, p_force: true })).toBe(
      "not_enough_players",
    );
  });
});

describe("classic samples", () => {
  async function seedSamples(counts: Record<string, number>) {
    for (const [category, n] of Object.entries(counts)) {
      for (let i = 0; i < n; i++) {
        await db.query("insert into public.samples (name, storage_path, category) values ($1, $2, $3)", [
          `${category}-${i}`,
          `kits/${category}-${i}.wav`,
          category,
        ]);
      }
    }
  }

  const picks = (s: State) => s.assets.filter((a) => a.kind === "sample").map((a) => a.sample!);
  const countBy = (samples: { category: string }[]) =>
    samples.reduce<Record<string, number>>((acc, x) => ({ ...acc, [x.category]: (acc[x.category] ?? 0) + 1 }), {});

  it("follows the default recipe with distinct picks shared by the room", async () => {
    await seedSamples({ kick: 4, snare: 4, hihat: 4, "808": 4, synth: 6, perc: 4, clap: 3, fx: 3 });
    const { players, roomId } = await roomWith(3, { p_mode: "classic" });
    await startGame(players[0], roomId);
    const s = await snapshot(players[0], roomId);
    const samples = picks(s);
    expect(countBy(samples)).toEqual({ kick: 1, snare: 1, hihat: 1, "808": 1, synth: 3, perc: 1 });
    expect(new Set(samples.map((x) => x.id)).size).toBe(samples.length);
    expect(s.assets.map((a) => a.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(samples.map((x) => x.category)).toEqual(["kick", "snare", "hihat", "808", "synth", "synth", "synth", "perc"]);
    expect(picks(await snapshot(players[2], roomId))).toEqual(samples);
  });

  it("hands out what exists when the pool is short", async () => {
    await seedSamples({ kick: 1, synth: 2 });
    const { players, roomId } = await roomWith(2, { p_mode: "classic" });
    await startGame(players[0], roomId);
    const samples = picks(await snapshot(players[0], roomId));
    expect(countBy(samples)).toEqual({ kick: 1, synth: 2 });
    expect(new Set(samples.map((x) => x.id)).size).toBe(3);
  });

  it("reads the recipe from the config table", async () => {
    await seedSamples({ kick: 3, clap: 3 });
    await db.exec("delete from public.sample_recipe; insert into public.sample_recipe (category, count) values ('clap', 2)");
    const { players, roomId } = await roomWith(2, { p_mode: "classic" });
    await startGame(players[0], roomId);
    expect(countBy(picks(await snapshot(players[0], roomId)))).toEqual({ clap: 2 });
  });

  it("draws fresh picks on a rematch", async () => {
    await seedSamples({ kick: 2, snare: 2, hihat: 2, "808": 2, synth: 6, perc: 2 });
    const { players, roomId } = await roomWith(2, { p_mode: "classic" });
    await startGame(players[0], roomId);
    await rpc(db, players[1], "room_heartbeat");
    const first = picks(await snapshot(players[0], roomId)).map((x) => x.id);
    await expirePhase(roomId);
    await rpc(db, players[0], "advance_room", { p_room_id: roomId });
    await expirePhase(roomId);
    await rpc(db, players[0], "advance_room", { p_room_id: roomId });
    expect((await snapshot(players[0], roomId)).room.status).toBe("lobby");

    await startGame(players[0], roomId);
    const s = await snapshot(players[0], roomId);
    expect(s.room.round).toBe(2);
    const second = picks(s).map((x) => x.id);
    expect(second).toHaveLength(8);
    expect(second.filter((id) => first.includes(id))).toEqual([]);
  });
});

describe("producing", () => {
  it("only submits verified uploads the caller reserved for this round", async () => {
    const { players, roomId } = await roomWith(2);
    const [a, b] = players;
    expect(await rpcError(db, a, "reserve_upload", { p_room_id: roomId, p_kind: "submission" })).toBe("wrong_phase");

    await startGame(a, roomId);
    const pending = await rpc<{ upload_id: string; path: string }>(db, a, "reserve_upload", {
      p_room_id: roomId,
      p_kind: "submission",
    });
    expect(pending.path).toBe(pending.upload_id);
    expect(await rpcError(db, a, "submit_track", { p_room_id: roomId, p_upload_id: pending.upload_id })).toBe(
      "upload_not_verified",
    );

    const { uploadId, finalPath } = await verifiedUpload(db, a, roomId, 123456);
    expect(await rpcError(db, b, "submit_track", { p_room_id: roomId, p_upload_id: uploadId })).toBe(
      "upload_not_verified",
    );
    await rpc(db, a, "submit_track", { p_room_id: roomId, p_upload_id: uploadId });
    const { rows } = await db.query("select storage_path, duration_ms from public.submissions");
    expect(rows).toEqual([{ storage_path: finalPath, duration_ms: 123456 }]);
  });

  it("replaces a resubmission and reports the old object for deletion", async () => {
    const { players, roomId } = await roomWith(3);
    await startGame(players[0], roomId);
    const first = await submit(players[0], roomId);
    const firstPath = (await snapshot(players[0], roomId)).my_submission!.storage_path;
    const { uploadId, finalPath } = await verifiedUpload(db, players[0], roomId, 90000);
    const second = await rpc<{ submission_id: string; replaced_path: string | null }>(db, players[0], "submit_track", {
      p_room_id: roomId,
      p_upload_id: uploadId,
    });
    expect(second).toEqual({ submission_id: first, replaced_path: firstPath });
    const mine = await snapshot(players[0], roomId);
    expect(mine.my_submission).toMatchObject({ id: first, storage_path: finalPath, duration_ms: 90000, confirmed: false });
    expect(mine.submitted_user_ids).toEqual([]);
    const { rows } = await db.query("select id from public.submissions");
    expect(rows).toHaveLength(1);
  });

  it("advances to listening as soon as everyone has submitted", async () => {
    const { players, roomId } = await roomWith(2);
    await startGame(players[0], roomId);
    await submit(players[0], roomId);
    expect((await snapshot(players[0], roomId)).room.status).toBe("producing");
    await submit(players[1], roomId);
    const s = await snapshot(players[0], roomId);
    expect(s.room.status).toBe("listening");
    expect(s.room.track_order).toHaveLength(2);
    expect(s.room.current_track).toBe(0);
    expect(Date.parse(s.room.track_started_at!)).toBeGreaterThan(Date.now());
  });

  it("does not advance before the deadline, then advances once after it", async () => {
    const { players, roomId } = await roomWith(3);
    await startGame(players[0], roomId);
    await submit(players[1], roomId);
    const before = await rpc<{ advanced: boolean; version: number }>(db, players[2], "advance_room", { p_room_id: roomId });
    expect(before.advanced).toBe(false);

    await expirePhase(roomId);
    expect(
      await rpcError(db, players[2], "submit_track", { p_room_id: roomId, p_upload_id: crypto.randomUUID() }),
    ).toBe("deadline_passed");

    const first = await rpc<{ advanced: boolean; version: number }>(db, players[2], "advance_room", { p_room_id: roomId });
    const second = await rpc<{ advanced: boolean; version: number }>(db, players[0], "advance_room", { p_room_id: roomId });
    expect(first.advanced).toBe(true);
    expect(second).toEqual({ advanced: false, version: first.version });

    const s = await snapshot(players[0], roomId);
    expect(s.room.status).toBe("listening");
    expect(s.room.track_order).toHaveLength(1);
    expect(s.version).toBe(first.version);
  });

  it("goes straight to results when nobody submitted", async () => {
    const { players, roomId } = await roomWith(2);
    await startGame(players[0], roomId);
    await expirePhase(roomId);
    await rpc(db, players[1], "advance_room", { p_room_id: roomId });
    const s = await snapshot(players[0], roomId);
    expect(s.room.status).toBe("results");
    expect(s.results).toEqual([]);
  });

  it("only members may advance", async () => {
    const { roomId } = await roomWith(2);
    const [outsider] = await users(1);
    expect(await rpcError(db, outsider, "advance_room", { p_room_id: roomId })).toBe("not_member");
  });
});

describe("listening and voting", () => {
  async function listeningRoom(n: number) {
    const room = await roomWith(n);
    await startGame(room.players[0], room.roomId);
    for (const p of room.players) await submit(p, room.roomId);
    return room;
  }

  it("enforces score range, no self vote, current track only, and lets votes change", async () => {
    const { players, roomId } = await listeningRoom(3);
    const s = await snapshot(players[0], roomId);
    const track = currentTrack(s);
    const owner = (await ownerOf(track));
    const [voter, other] = players.filter((p) => p !== owner);
    const nextTrack = s.room.track_order[1];
    await beginPlayback(roomId);

    for (const score of [0, 6]) {
      expect(await rpcError(db, voter, "cast_vote", { p_room_id: roomId, p_submission_id: track, p_score: score })).toBe(
        "invalid_score",
      );
    }
    expect(await rpcError(db, owner, "cast_vote", { p_room_id: roomId, p_submission_id: track, p_score: 5 })).toBe(
      "self_vote",
    );
    expect(await rpcError(db, voter, "cast_vote", { p_room_id: roomId, p_submission_id: nextTrack, p_score: 5 })).toBe(
      "not_current_track",
    );

    await vote(voter, roomId, track, 4);
    const version = (await snapshot(voter, roomId)).version;
    await vote(voter, roomId, track, 2);
    const changed = await snapshot(voter, roomId);
    expect(changed.my_votes).toEqual([{ submission_id: track, score: 2 }]);
    expect(changed.version).toBe(version);
    expect(changed.current_votes).toMatchObject({ count: 1 });
    expect((await snapshot(other, roomId)).my_votes).toEqual([]);
  });

  it("hides other players' scores at the table level", async () => {
    const { players, roomId } = await listeningRoom(3);
    const s = await snapshot(players[0], roomId);
    const track = currentTrack(s);
    const owner = await ownerOf(track);
    const voter = players.find((p) => p !== owner)!;
    await vote(voter, roomId, track, 3);
    for (const p of players) {
      const visible = await asUser(db, p, (tx) => tx.query("select * from public.votes"));
      expect(visible.rows).toHaveLength(p === voter ? 1 : 0);
    }
  });

  it("rejects self votes at the schema level too", async () => {
    const { players, roomId } = await listeningRoom(2);
    const s = await snapshot(players[0], roomId);
    const track = currentTrack(s);
    await expect(
      db.query("insert into public.votes (room_id, round, submission_id, voter_id, score) values ($1, 1, $2, $3, 5)", [
        roomId,
        track,
        (await ownerOf(track)),
      ]),
    ).rejects.toThrow("self_vote");
  });

  it("never ends a track early for votes and starts the next lead-in at clip end", async () => {
    const { players, roomId } = await listeningRoom(3);
    const s = await snapshot(players[0], roomId);
    const track = currentTrack(s);
    const owner = await ownerOf(track);
    const voters = players.filter((p) => p !== owner);
    for (const v of voters) await vote(v, roomId, track, 3);

    const after = await snapshot(players[0], roomId);
    expect(after.room.current_track).toBe(0);
    expect(after.room.phase_ends_at).toBe(s.room.phase_ends_at);
    expect((await rpc<{ advanced: boolean }>(db, players[0], "advance_room", { p_room_id: roomId })).advanced).toBe(false);

    await finishTrackPlayback(roomId);
    const advancedAt = Date.now();
    expect((await rpc<{ advanced: boolean }>(db, players[0], "advance_room", { p_room_id: roomId })).advanced).toBe(true);
    const next = await snapshot(players[0], roomId);
    expect(next.room.current_track).toBe(1);
    expect(Date.parse(next.room.track_started_at!) - advancedAt).toBeGreaterThanOrEqual(2900);
    expect(Date.parse(next.room.track_started_at!) - advancedAt).toBeLessThan(3500);
    expect(Date.parse(next.room.phase_ends_at!) - Date.parse(next.room.track_started_at!)).toBe(45000);
  });

  it("moves on when the track's deadline passes without all votes", async () => {
    const { players, roomId } = await listeningRoom(2);
    await expirePhase(roomId);
    await rpc(db, players[0], "advance_room", { p_room_id: roomId });
    expect((await snapshot(players[0], roomId)).room.current_track).toBe(1);
    await expirePhase(roomId);
    await rpc(db, players[0], "advance_room", { p_room_id: roomId });
    expect((await snapshot(players[0], roomId)).room.status).toBe("reviewing");
    await endReview(db, roomId);
    expect((await snapshot(players[0], roomId)).room.status).toBe("results");
  });

  it("rejects votes after the deadline", async () => {
    const { players, roomId } = await listeningRoom(2);
    const s = await snapshot(players[0], roomId);
    const track = currentTrack(s);
    const owner = await ownerOf(track);
    const voter = players.find((p) => p !== owner)!;
    await finishTrackPlayback(roomId);
    expect(await rpcError(db, voter, "cast_vote", { p_room_id: roomId, p_submission_id: track, p_score: 5 })).toBe(
      "deadline_passed",
    );
  });
});

describe("results", () => {
  const scoresFor: Record<string, Record<string, number>> = {
    a: { b: 4, c: 4, d: 4 },
    b: { a: 5, c: 3, d: 4 },
    c: { a: 2, b: 2, d: 2 },
  };

  it("averages scores, ties equal averages, skips non-submitters, updates stats", async () => {
    const { players, roomId } = await roomWith(4);
    const [a, b, c, d] = players;
    const name: Record<string, string> = { [a]: "a", [b]: "b", [c]: "c", [d]: "d" };
    await startGame(a, roomId);
    for (const p of [a, b, c]) await submit(p, roomId);
    await expirePhase(roomId);
    await rpc(db, d, "advance_room", { p_room_id: roomId });

    for (let i = 0; i < 3; i++) {
      const s = await snapshot(a, roomId);
      expect(s.room.status).toBe("listening");
      const track = currentTrack(s);
      const owner = name[(await ownerOf(track))];
      for (const voter of players.filter((p) => name[p] !== owner)) {
        await vote(voter, roomId, track, scoresFor[owner][name[voter]]);
      }
      await finishTrackPlayback(roomId);
      await rpc(db, a, "advance_room", { p_room_id: roomId });
    }
    await endReview(db, roomId);

    const s = await snapshot(a, roomId);
    expect(s.room.status).toBe("results");
    const byName = Object.fromEntries(s.results.map((r) => [name[r.user_id], r]));
    expect(Object.keys(byName).sort()).toEqual(["a", "b", "c"]);
    expect(byName.a).toMatchObject({ avg_score: 4, vote_count: 3, rank: 1, is_winner: true });
    expect(byName.b).toMatchObject({ avg_score: 4, vote_count: 3, rank: 1, is_winner: true });
    expect(byName.c).toMatchObject({ avg_score: 2, vote_count: 3, rank: 3, is_winner: false });

    const { rows } = await db.query<{ id: string; wins: number; ties: number; games_played: number }>(
      "select id, wins, ties, games_played from public.profiles",
    );
    const stats = Object.fromEntries(rows.map((r) => [name[r.id], r]));
    expect(stats.a).toMatchObject({ wins: 0, ties: 1, games_played: 1 });
    expect(stats.b).toMatchObject({ wins: 0, ties: 1, games_played: 1 });
    expect(stats.c).toMatchObject({ wins: 0, ties: 0, games_played: 1 });
    expect(stats.d).toMatchObject({ wins: 0, ties: 0, games_played: 0 });

    await expirePhase(roomId);
    await rpc(db, a, "advance_room", { p_room_id: roomId });
    const lobby = await snapshot(a, roomId);
    expect(lobby.room.status).toBe("lobby");
    expect(lobby.room.phase_ends_at).toBeNull();
    expect(lobby.players.every((p) => !p.is_ready)).toBe(true);

    await startGame(a, roomId);
    const rematch = await snapshot(a, roomId);
    expect(rematch.room.round).toBe(2);
    expect(rematch.submissions).toEqual([]);
    expect(rematch.results).toEqual([]);
  });

  it("gives a sole winner a win", async () => {
    const { players, roomId } = await roomWith(2);
    const [a, b] = players;
    await startGame(a, roomId);
    await submit(a, roomId);
    await submit(b, roomId);
    for (let i = 0; i < 2; i++) {
      const s = await snapshot(a, roomId);
      const track = currentTrack(s);
      const owner = (await ownerOf(track));
      const voter = owner === a ? b : a;
      await vote(voter, roomId, track, owner === a ? 5 : 1);
      await finishTrackPlayback(roomId);
      await rpc(db, a, "advance_room", { p_room_id: roomId });
    }
    await endReview(db, roomId);
    const { rows } = await db.query<{ id: string; wins: number }>("select id, wins from public.profiles");
    expect(rows.find((r) => r.id === a)!.wins).toBe(1);
    expect(rows.find((r) => r.id === b)!.wins).toBe(0);
  });
});

describe("leaving", () => {
  it("hands host to the longest-standing player and closes when empty", async () => {
    const { players, roomId, code } = await roomWith(3);
    const [a, b, c] = players;
    await rpc(db, a, "leave_room", { p_room_id: roomId });
    expect((await snapshot(b, roomId)).room.host_id).toBe(b);
    await rpc(db, c, "leave_room", { p_room_id: roomId });
    expect((await snapshot(b, roomId)).room.host_id).toBe(b);
    await rpc(db, b, "leave_room", { p_room_id: roomId });
    expect((await snapshot(b, roomId)).room.status).toBe("closed");
    expect(await rpcError(db, a, "join_room", { p_code: code })).toBe("room_closed");
  });

  it("advances when the last missing submitter leaves", async () => {
    const { players, roomId } = await roomWith(3);
    await startGame(players[0], roomId);
    await submit(players[0], roomId);
    await submit(players[1], roomId);
    await rpc(db, players[2], "leave_room", { p_room_id: roomId });
    expect((await snapshot(players[0], roomId)).room.status).toBe("listening");
  });
});

describe("realtime", () => {
  it("broadcasts one full room_state per state change with increasing versions", async () => {
    const { players, roomId } = await roomWith(2);
    await startGame(players[0], roomId);
    await submit(players[0], roomId);
    await submit(players[1], roomId);
    const states = await broadcasts(roomId, "room_state");
    const versions = states.map((s) => s.version);
    expect(versions).toEqual([2, 3, 4, 5, 6, 7]);
    const last = states.at(-1) as unknown as State;
    expect(last.room.status).toBe("listening");
    expect(last).not.toHaveProperty("my_votes");
    expect((await snapshot(players[0], roomId)).version).toBe(7);
  });

  it("broadcasts only the committed state when a transaction bumps twice", async () => {
    const { roomId } = await roomWith(2);
    const before = (await broadcasts(roomId, "room_state")).length;
    await db.transaction(async (tx) => {
      await tx.query("select public._bump($1)", [roomId]);
      await tx.query("select public._bump($1)", [roomId]);
    });
    const states = await broadcasts(roomId, "room_state");
    expect(states).toHaveLength(before + 1);
    expect(states.at(-1)!.version).toBe(4);
  });

  it("does not broadcast no-op advances", async () => {
    const { players, roomId } = await roomWith(2);
    const before = (await broadcasts(roomId, "room_state")).length;
    await rpc(db, players[0], "advance_room", { p_room_id: roomId });
    expect(await broadcasts(roomId, "room_state")).toHaveLength(before);
  });

  it("broadcasts chat and rate limits it", async () => {
    const { players, roomId } = await roomWith(2);
    await rpc(db, players[1], "send_chat", { p_room_id: roomId, p_body: "  gl hf  " });
    const [msg] = await broadcasts(roomId, "chat");
    expect(msg).toMatchObject({ body: "gl hf", user_id: players[1] });
    expect(await rpcError(db, players[1], "send_chat", { p_room_id: roomId, p_body: "   " })).toBe("invalid_message");
    for (let i = 0; i < 4; i++) await rpc(db, players[1], "send_chat", { p_room_id: roomId, p_body: `m${i}` });
    expect(await rpcError(db, players[1], "send_chat", { p_room_id: roomId, p_body: "spam" })).toBe("rate_limited");
    expect((await snapshot(players[0], roomId)).chat.map((m) => m.body)).toEqual(["gl hf", "m0", "m1", "m2", "m3"]);
  });

  it("lets only active members read and track presence on the room topic", async () => {
    const { players, roomId } = await roomWith(2);
    const [outsider] = await users(1);
    await rpc(db, players[0], "set_ready", { p_room_id: roomId, p_ready: true });
    const topic = { "realtime.topic": `room:${roomId}` };
    const read = (u: string) =>
      asUser(db, u, (tx) => tx.query("select * from realtime.messages"), topic).then((r) => r.rows.length);
    expect(await read(players[1])).toBeGreaterThan(0);
    expect(await read(outsider)).toBe(0);

    const track = (u: string, extension: string) =>
      asUser(
        db,
        u,
        (tx) => tx.query("insert into realtime.messages (topic, extension) values ($1, $2)", [`room:${roomId}`, extension]),
        topic,
      ).then(
        () => "ok",
        (e: Error) => e.message,
      );
    expect(await track(players[1], "presence")).toBe("ok");
    expect(await track(players[1], "broadcast")).toMatch(/row-level security/);
    expect(await track(outsider, "presence")).toMatch(/row-level security/);
  });
});

describe("sweep", () => {
  it("advances only rooms whose deadline passed", async () => {
    const stale = await roomWith(2);
    const live = await roomWith(2);
    await startGame(stale.players[0], stale.roomId);
    await startGame(live.players[0], live.roomId);
    await submit(stale.players[0], stale.roomId);
    await expirePhase(stale.roomId);

    const { rows } = await db.query<{ n: number }>("select public.sweep_rooms() as n");
    expect(rows[0].n).toBe(1);
    expect((await snapshot(stale.players[0], stale.roomId)).room.status).toBe("listening");
    expect((await snapshot(live.players[0], live.roomId)).room.status).toBe("producing");
  });

  it("is not callable by clients", async () => {
    const [a] = await users(1);
    expect(await rpcError(db, a, "sweep_rooms")).toMatch(/permission denied/);
  });
});

describe("room names", () => {
  const username = async (id: string) =>
    (await db.query<{ username: string }>("select username from public.profiles where id = $1", [id])).rows[0].username;

  it("defaults to the host's name and trims custom names", async () => {
    const [a, b, c] = await users(3);
    const fallback = await createRoom(a);
    expect((await snapshot(a, fallback.room_id)).room.name).toBe(`${await username(a)}'s room`);
    const blank = await createRoom(b, { p_name: "   " });
    expect((await snapshot(b, blank.room_id)).room.name).toBe(`${await username(b)}'s room`);
    const named = await createRoom(c, { p_name: "  Late Night Flips  " });
    expect((await snapshot(c, named.room_id)).room.name).toBe("Late Night Flips");
  });

  it("rejects names over 40 characters", async () => {
    const [a] = await users(1);
    expect(await rpcError(db, a, "create_room", { p_mode: "creative", p_name: "x".repeat(41) })).toBe("invalid_name");
    const ok = await createRoom(a, { p_name: "x".repeat(40) });
    expect((await snapshot(a, ok.room_id)).room.name).toHaveLength(40);
  });

  it("includes the name in broadcasts", async () => {
    const { players, roomId } = await roomWith(2, { p_name: "Beat Lab" });
    await rpc(db, players[1], "set_ready", { p_room_id: roomId, p_ready: true });
    const last = (await broadcasts(roomId, "room_state")).at(-1) as unknown as State;
    expect(last.room.name).toBe("Beat Lab");
  });
});

describe("quick match", () => {
  type QuickMatch = RoomRef & { created: boolean };
  const quickMatch = (userId: string, mode = "creative") => rpc<QuickMatch>(db, userId, "quick_match", { p_mode: mode });

  it("joins the fullest open public lobby of the mode, skipping everything else", async () => {
    const small = await roomWith(2);
    const best = await roomWith(3);
    await roomWith(2, { p_max_players: 2 });
    await roomWith(4, { p_is_private: true });
    const started = await roomWith(4);
    await startGame(started.players[0], started.roomId);
    await roomWith(4, { p_mode: "classic" });

    const [me] = await users(1);
    const result = await quickMatch(me);
    expect(result).toMatchObject({ room_id: best.roomId, code: best.code, created: false });
    expect((await snapshot(me, best.roomId)).players.map((p) => p.user_id)).toContain(me);
    expect(small.roomId).not.toBe(result.room_id);
  });

  it("prefers the oldest lobby among equally full ones", async () => {
    const older = await roomWith(2);
    await roomWith(2);
    const [me] = await users(1);
    expect((await quickMatch(me)).room_id).toBe(older.roomId);
  });

  it("opens a public lobby with default settings when none exists, and the next player lands in it", async () => {
    await roomWith(3, { p_mode: "classic" });
    const [first, second] = await users(2);
    const created = await quickMatch(first, "premade");
    expect(created.created).toBe(true);
    const s = await snapshot(first, created.room_id);
    expect(s.room).toMatchObject({ mode: "premade", is_private: false, status: "lobby" });

    const joined = await quickMatch(second, "premade");
    expect(joined).toMatchObject({ room_id: created.room_id, created: false });
    expect((await snapshot(second, created.room_id)).players).toHaveLength(2);
  });

  it("leaves the player's previous room with host handoff", async () => {
    const previous = await roomWith(2, { p_mode: "classic" });
    const target = await roomWith(2);
    const [host, member] = previous.players;
    const result = await quickMatch(host);
    expect(result.room_id).toBe(target.roomId);
    expect((await snapshot(member, previous.roomId)).room.host_id).toBe(member);
  });

  it("keeps a player in their lobby when it is already the best match", async () => {
    const { players, roomId } = await roomWith(3);
    await roomWith(2);
    const before = await snapshot(players[1], roomId);
    const result = await quickMatch(players[1]);
    expect(result).toMatchObject({ room_id: roomId, version: before.version, created: false });
  });

  it("rejects unknown modes and anonymous callers", async () => {
    const [a] = await users(1);
    expect(await rpcError(db, a, "quick_match", { p_mode: "freestyle" })).toBe("invalid_mode");
    expect(await rpcError(db, null, "quick_match", { p_mode: "creative" })).toBe("not_authenticated");
  });
});

describe("public lobby list", () => {
  type Listed = {
    id: string;
    code: string;
    name: string;
    mode: string;
    status: string;
    max_players: number;
    player_count: number;
    host_username: string;
    round: number;
    phase_ends_at: string | null;
    estimated_end_at: string | null;
    joinable: boolean;
    created_at: string;
  };

  it("lists open and in-progress public rooms with their details", async () => {
    const open = await roomWith(2, { p_name: "Open One" });
    const full = await roomWith(2, { p_max_players: 2 });
    const producing = await roomWith(3, { p_name: "Cooking" });
    await startGame(producing.players[0], producing.roomId);
    const listening = await roomWith(2);
    await startGame(listening.players[0], listening.roomId);
    for (const p of listening.players) await submit(p, listening.roomId);
    await roomWith(2, { p_is_private: true });
    const closed = await roomWith(1);
    await rpc(db, closed.players[0], "leave_room", { p_room_id: closed.roomId });

    const [viewer] = await users(1);
    const rooms = await rpc<Listed[]>(db, viewer, "list_public_rooms");
    expect(rooms.map((r) => r.id).sort()).toEqual(
      [open.roomId, full.roomId, producing.roomId, listening.roomId].sort(),
    );
    expect(rooms.slice(0, 2).every((r) => r.status === "lobby")).toBe(true);

    const byId = Object.fromEntries(rooms.map((r) => [r.id, r]));
    expect(byId[open.roomId]).toMatchObject({
      name: "Open One",
      mode: "creative",
      status: "lobby",
      player_count: 2,
      max_players: 8,
      round: 0,
      joinable: true,
      phase_ends_at: null,
      estimated_end_at: null,
    });
    expect(byId[open.roomId].host_username).toMatch(/^producer_/);
    expect(byId[full.roomId].joinable).toBe(false);

    const cooking = byId[producing.roomId];
    expect(cooking).toMatchObject({ name: "Cooking", status: "producing", round: 1, player_count: 3, joinable: false });
    const assumed = 3 * (3 + 45) + 60;
    expect(Date.parse(cooking.estimated_end_at!) - Date.parse(cooking.phase_ends_at!)).toBe(assumed * 1000);

    const live = byId[listening.roomId];
    expect(live.status).toBe("listening");
    expect(Date.parse(live.estimated_end_at!) - Date.parse(live.phase_ends_at!)).toBe((60 + 3 + 45) * 1000);
  });
});

describe("update_room_settings", () => {
  const update = (userId: string, roomId: string, changes: Record<string, unknown>) =>
    rpc(db, userId, "update_room_settings", { p_room_id: roomId, ...changes });
  const updateError = (userId: string, roomId: string, changes: Record<string, unknown>) =>
    rpcError(db, userId, "update_room_settings", { p_room_id: roomId, ...changes });

  it("lets the host change settings in the lobby and bumps the version once", async () => {
    const { players, roomId } = await roomWith(2);
    const before = await snapshot(players[0], roomId);
    await update(players[0], roomId, {
      p_name: "  Flip Night ",
      p_max_players: 4,
      p_produce_seconds: 600,
      p_vote_seconds: 99,
      p_listen_seconds: 30,
      p_reveal_names: true,
      p_is_private: true,
      p_mode: "classic",
    });
    const after = await snapshot(players[1], roomId);
    expect(after.version).toBe(before.version + 1);
    expect(after.room).toMatchObject({
      name: "Flip Night",
      max_players: 4,
      produce_seconds: 600,
      vote_seconds: 20,
      listen_seconds: 30,
      reveal_names: true,
      is_private: true,
      mode: "classic",
    });
    const last = (await broadcasts(roomId, "room_state")).at(-1) as unknown as State;
    expect(last.version).toBe(after.version);
    expect(last.room.name).toBe("Flip Night");
  });

  it("leaves omitted settings unchanged", async () => {
    const { players, roomId } = await roomWith(2, { p_name: "Keep Me", p_listen_seconds: 50 });
    await update(players[0], roomId, { p_max_players: 3 });
    expect((await snapshot(players[0], roomId)).room).toMatchObject({ name: "Keep Me", listen_seconds: 50, max_players: 3 });
  });

  const readyFlags = async (roomId: string, viewer: string) =>
    Object.fromEntries((await snapshot(viewer, roomId)).players.map((p) => [p.user_id, p.is_ready]));

  it.each([
    ["mode", { p_mode: "classic" }],
    ["produce duration", { p_produce_seconds: 600 }],
    ["listen cap", { p_listen_seconds: 30 }],
  ])("resets non-host ready flags when the %s changes", async (_label, change) => {
    const { players, roomId } = await roomWith(3);
    const [host, b, c] = players;
    await rpc(db, host, "set_ready", { p_room_id: roomId, p_ready: true });
    await rpc(db, b, "set_ready", { p_room_id: roomId, p_ready: true });
    await rpc(db, c, "set_ready", { p_room_id: roomId, p_ready: true });
    const before = await snapshot(host, roomId);
    await update(host, roomId, change);
    expect(await readyFlags(roomId, host)).toEqual({ [host]: true, [b]: false, [c]: false });
    const after = await snapshot(host, roomId);
    expect(after.version).toBe(before.version + 1);
    expect(after.readiness).toMatchObject({ ready: 1, total: 3, all_ready: false });
  });

  it("keeps ready flags for cosmetic changes or unchanged values", async () => {
    const { players, roomId } = await roomWith(2, { p_produce_seconds: 600 });
    const [host, b] = players;
    await rpc(db, b, "set_ready", { p_room_id: roomId, p_ready: true });
    await update(host, roomId, { p_name: "Renamed", p_max_players: 4, p_is_private: true });
    await update(host, roomId, { p_mode: "creative", p_produce_seconds: 600, p_listen_seconds: 45 });
    await update(host, roomId, { p_vote_seconds: 99, p_reveal_names: true });
    expect((await readyFlags(roomId, host))[b]).toBe(true);
  });

  it("is host-only and lobby-only", async () => {
    const { players, roomId } = await roomWith(2);
    const [outsider] = await users(1);
    expect(await updateError(players[1], roomId, { p_name: "Mine" })).toBe("not_host");
    expect(await updateError(outsider, roomId, { p_name: "Mine" })).toBe("not_member");
    await startGame(players[0], roomId);
    expect(await updateError(players[0], roomId, { p_name: "Later" })).toBe("wrong_phase");
  });

  it("validates ranges, mode, name and seat count", async () => {
    const { players, roomId } = await roomWith(3);
    const host = players[0];
    expect(await updateError(host, roomId, { p_max_players: 17 })).toBe("invalid_settings");
    expect(await updateError(host, roomId, { p_produce_seconds: 59 })).toBe("invalid_settings");
    expect(await updateError(host, roomId, { p_listen_seconds: 29 })).toBe("invalid_settings");
    expect(await updateError(host, roomId, { p_listen_seconds: 61 })).toBe("invalid_settings");
    expect(await updateError(host, roomId, { p_mode: "freestyle" })).toBe("invalid_mode");
    expect(await updateError(host, roomId, { p_name: "x".repeat(41) })).toBe("invalid_name");
    expect(await updateError(host, roomId, { p_max_players: 2 })).toBe("max_players_below_count");
    await update(host, roomId, { p_max_players: 3 });
    expect((await snapshot(host, roomId)).room).toMatchObject({ max_players: 3 });
  });
});

describe("get_profile", () => {
  async function playRound() {
    const { players, roomId } = await roomWith(2, { p_name: "Profile Room" });
    const [a, b] = players;
    await startGame(a, roomId);
    await submit(a, roomId);
    await submit(b, roomId);
    for (let i = 0; i < 2; i++) {
      const s = await snapshot(a, roomId);
      const track = currentTrack(s);
      const owner = (await ownerOf(track));
      await vote(owner === a ? b : a, roomId, track, owner === a ? 5 : 2);
      await finishTrackPlayback(roomId);
      await rpc(db, a, "advance_room", { p_room_id: roomId });
    }
    await endReview(db, roomId);
    return { a, b, roomId };
  }

  const asAnon = <T,>(fn: string, args: unknown[]) =>
    db.transaction(async (tx) => {
      await tx.exec("set local role anon");
      const { rows } = await tx.query<{ result: T }>(`select public.${fn}($1) as result`, args);
      return rows[0].result;
    });

  type Profile = {
    profile: Record<string, unknown>;
    recent_results: Record<string, unknown>[];
  };

  it("returns public fields and recent results, readable without signing in", async () => {
    const { a } = await playRound();
    const { rows } = await db.query<{ username: string }>("select username from public.profiles where id = $1", [a]);
    const result = await asAnon<Profile>("get_profile", [rows[0].username.toUpperCase()]);

    expect(Object.keys(result.profile).sort()).toEqual(
      ["avatar_url", "bio", "created_at", "daws", "display_name", "games_played", "id", "link_url", "ties", "username", "wins"].sort(),
    );
    expect(result.profile).toMatchObject({ id: a, wins: 1, ties: 0, games_played: 1 });
    expect(result.recent_results).toHaveLength(1);
    expect(Object.keys(result.recent_results[0]).sort()).toEqual(
      ["avg_score", "entrants", "finished_at", "is_winner", "mode", "rank", "room_name", "round", "vote_count"].sort(),
    );
    expect(result.recent_results[0]).toMatchObject({
      room_name: "Profile Room",
      mode: "creative",
      round: 1,
      avg_score: 5,
      vote_count: 1,
      rank: 1,
      entrants: 2,
      is_winner: true,
    });
  });

  it("never leaks storage paths, votes or private room names", async () => {
    const { a, b, roomId } = await playRound();
    await db.query("update public.rooms set is_private = true where id = $1", [roomId]);
    const { rows: paths } = await db.query<{ storage_path: string }>("select storage_path from public.submissions");
    const { rows: names } = await db.query<{ username: string }>("select username from public.profiles where id = $1", [
      b,
    ]);
    const result = await rpc<Profile>(db, a, "get_profile", { p_username: names[0].username });
    const json = JSON.stringify(result);
    for (const { storage_path } of paths) expect(json).not.toContain(storage_path);
    expect(json).not.toContain(a);
    expect(json).not.toMatch(/voter|storage|"score"/);
    expect(result.recent_results[0].room_name).toBeNull();
  });

  it("reports unknown usernames", async () => {
    expect(await asAnon("get_profile", ["nobody_here"]).catch((e: Error) => e.message)).toBe("profile_not_found");
  });
});

describe("online presence topic", () => {
  const online = { "realtime.topic": "online" };
  const attempt = (userId: string, extension: string, settings = online) =>
    asUser(
      db,
      userId,
      (tx) => tx.query("insert into realtime.messages (topic, extension) values ('online', $1)", [extension]),
      settings,
    ).then(
      () => "ok",
      (e: Error) => e.message,
    );

  it("lets signed-in users track and read presence on exactly the online topic", async () => {
    const [a, b] = await users(2);
    expect(await attempt(a, "presence")).toBe("ok");
    const seen = await asUser(db, b, (tx) => tx.query("select * from realtime.messages"), online);
    expect(seen.rows).toHaveLength(1);
  });

  it("rejects broadcasts, other topics and signed-out clients", async () => {
    const [a] = await users(1);
    expect(await attempt(a, "broadcast")).toMatch(/row-level security/);
    expect(await attempt(a, "presence", { "realtime.topic": "online:x" })).toMatch(/row-level security/);
    const anon = await db
      .transaction(async (tx) => {
        await tx.query("select set_config('realtime.topic', 'online', true)");
        await tx.exec("set local role anon");
        await tx.query("insert into realtime.messages (topic, extension) values ('online', 'presence')");
      })
      .then(
        () => "ok",
        (e: Error) => e.message,
      );
    expect(anon).toMatch(/permission denied|row-level security/);
  });

  it("does not open room topics to non-members", async () => {
    const { roomId } = await roomWith(2);
    const [outsider] = await users(1);
    expect(await attempt(outsider, "presence", { "realtime.topic": `room:${roomId}` })).toMatch(/row-level security/);
  });
});

describe("row level security", () => {
  it("hides private rooms from non-members and blocks direct writes", async () => {
    const [a, b, c] = await users(3);
    const priv = await createRoom(a, { p_is_private: true });
    const pub = await createRoom(c);
    const visible = await asUser(db, b, (tx) => tx.query<{ id: string }>("select id from public.rooms"));
    expect(visible.rows.map((r) => r.id)).toEqual([pub.room_id]);
    expect(await rpc<unknown[]>(db, b, "list_public_rooms")).toHaveLength(1);

    const write = await asUser(db, a, (tx) =>
      tx.query("update public.rooms set status = 'results' where id = $1", [priv.room_id]),
    ).catch((e: Error) => e.message);
    expect(write).toMatch(/permission denied/);
  });

  it("lets users edit only their own profile's editable fields", async () => {
    const [a, b] = await users(2);
    await asUser(db, a, (tx) => tx.query("update public.profiles set username = 'beatsmith' where id = $1", [a]));
    const other = await asUser(db, a, (tx) =>
      tx.query("update public.profiles set bio = 'hacked' where id = $1", [b]),
    );
    expect(other.affectedRows).toBe(0);
    const stats = await asUser(db, a, (tx) =>
      tx.query("update public.profiles set wins = 99 where id = $1", [a]),
    ).catch((e: Error) => e.message);
    expect(stats).toMatch(/permission denied/);
    const { rows } = await db.query<{ username: string }>("select username from public.profiles where id = $1", [a]);
    expect(rows[0].username).toBe("beatsmith");
  });
});

async function gameRoom(n: number, settings: Record<string, unknown> = {}, durations: number[] = []) {
  const room = await roomWith(n, settings);
  await startGame(room.players[0], room.roomId);
  for (const [i, p] of room.players.entries()) await submit(p, room.roomId, durations[i] ?? 60000);
  return room;
}

const makeStale = (roomId: string, userId: string) =>
  db.query("update public.room_players set last_seen_at = now() - interval '2 minutes' where room_id = $1 and user_id = $2", [
    roomId,
    userId,
  ]);

const canReadObject = (userId: string, path: string) =>
  asUser(db, userId, (tx) => tx.query("select name from storage.objects where name = $1", [path])).then(
    (r) => r.rows.length === 1,
  );

describe("blind listening and reveal_names", () => {
  it("defaults to blind and can be enabled at creation", async () => {
    const [a, b] = await users(2);
    const blind = await createRoom(a);
    expect((await snapshot(a, blind.room_id)).room.reveal_names).toBe(false);
    const open = await createRoom(b, { p_reveal_names: true });
    expect((await snapshot(b, open.room_id)).room.reveal_names).toBe(true);
  });

  it("hides who submitted what while producing", async () => {
    const { players, roomId } = await roomWith(3);
    const [a, b] = players;
    await startGame(a, roomId);
    const mine = await submit(a, roomId);
    const other = await snapshot(b, roomId);
    expect(other.submissions).toEqual([]);
    expect(other.submitted_user_ids).toEqual([a]);
    expect(other.my_submission).toBeNull();
    expect((await snapshot(a, roomId)).my_submission).toMatchObject({ id: mine, user_id: a });
    const rows = await asUser(db, b, (tx) => tx.query("select * from public.submissions"));
    expect(rows.rows).toEqual([]);
    const path = (await snapshot(a, roomId)).my_submission!.storage_path;
    expect(await canReadObject(b, path)).toBe(false);
    expect(await canReadObject(a, path)).toBe(true);
  });

  it("exposes no producer identity during blind listening", async () => {
    const { players, roomId } = await gameRoom(3);
    const [a, b, c] = players;
    const s = await snapshot(b, roomId);
    const track = currentTrack(s);
    const owner = await ownerOf(track);
    const voter = players.find((p) => p !== owner)!;
    await vote(voter, roomId, track, 4);

    for (const viewer of players) {
      const view = await snapshot(viewer, roomId);
      expect(view.submissions.map((x) => x.id)).toEqual(view.room.track_order);
      expect(view.submissions.every((x) => x.user_id === null && x.submitted_at === null)).toBe(true);
      expect(view.votes_cast).toEqual([]);
      expect(view.current_votes).toEqual({ submission_id: track, count: 1, eligible: 2 });
      expect(view.my_submission!.user_id).toBe(viewer);
      const json = JSON.stringify({
        ...view,
        room: { ...view.room, host_id: null },
        players: [],
        me: null,
        my_submission: null,
        submitted_user_ids: [],
      });
      for (const id of [a, b, c]) expect(json).not.toContain(id);
      const rows = await asUser(db, viewer, (tx) => tx.query<{ user_id: string }>("select user_id from public.submissions"));
      expect(rows.rows).toEqual([{ user_id: viewer }]);
      for (const x of view.submissions) expect(await canReadObject(viewer, x.storage_path)).toBe(true);
    }

    const payload = JSON.stringify((await broadcasts(roomId, "room_state")).at(-1));
    const stripped = JSON.parse(payload) as State;
    expect(stripped.submissions.every((x) => x.user_id === null)).toBe(true);
    expect(stripped.votes_cast).toEqual([]);
    expect(stripped).not.toHaveProperty("my_submission");
  });

  it("reveals the current and played producers when reveal_names is on", async () => {
    const { players, roomId } = await gameRoom(3, { p_reveal_names: true });
    let s = await snapshot(players[0], roomId);
    const first = currentTrack(s);
    const owner = await ownerOf(first);
    expect(s.submissions[0]).toMatchObject({ id: first, user_id: owner });
    expect(s.submissions.slice(1).every((x) => x.user_id === null)).toBe(true);
    const voter = players.find((p) => p !== owner)!;
    await vote(voter, roomId, first, 5);
    s = await snapshot(players[0], roomId);
    expect(s.votes_cast).toEqual([{ submission_id: first, voter_id: voter }]);
    expect(s.current_votes).toEqual({ submission_id: first, count: 1, eligible: 2, voted_user_ids: [voter] });

    await expirePhase(roomId);
    await rpc(db, players[0], "advance_room", { p_room_id: roomId });
    s = await snapshot(players[0], roomId);
    expect(s.submissions[0].user_id).toBe(owner);
    expect(s.submissions[1].user_id).toBe(await ownerOf(s.submissions[1].id));
    expect(s.submissions[2].user_id).toBeNull();
  });

  it("always reveals producers at results", async () => {
    const { players, roomId } = await gameRoom(2);
    for (let i = 0; i < 2; i++) {
      await expirePhase(roomId);
      await rpc(db, players[0], "advance_room", { p_room_id: roomId });
    }
    await endReview(db, roomId);
    const s = await snapshot(players[1], roomId);
    expect(s.room.status).toBe("results");
    expect(s.submissions.map((x) => x.user_id).sort()).toEqual([...players].sort());
    const rows = await asUser(db, players[1], (tx) => tx.query("select * from public.submissions"));
    expect(rows.rows).toHaveLength(2);
  });

  it("cuts a member who left off from the current round's audio and the room topic", async () => {
    const { players, roomId } = await gameRoom(3);
    const leaver = players[2];
    const s = await snapshot(leaver, roomId);
    await rpc(db, leaver, "leave_room", { p_room_id: roomId });
    const others = s.submissions.filter((x) => x.id !== s.my_submission!.id);
    expect(others).toHaveLength(2);
    for (const x of others) expect(await canReadObject(leaver, x.storage_path)).toBe(false);
    expect(await canReadObject(leaver, s.my_submission!.storage_path)).toBe(true);
    const topic = { "realtime.topic": `room:${roomId}` };
    const seen = await asUser(db, leaver, (tx) => tx.query("select * from realtime.messages"), topic);
    expect(seen.rows).toEqual([]);
  });
});

describe("listen cap and voting during playback", () => {
  it("defaults to 45s and validates the range", async () => {
    const [a] = await users(1);
    const room = await createRoom(a);
    expect((await snapshot(a, room.room_id)).room.listen_seconds).toBe(45);
    for (const bad of [29, 61]) {
      expect(await rpcError(db, a, "create_room", { p_mode: "creative", p_listen_seconds: bad })).toBe("invalid_settings");
    }
  });

  it("plays at most listen_seconds, with no grace after the clip", async () => {
    const { players, roomId } = await gameRoom(2, {}, [120000, 20000]);
    let s = await snapshot(players[0], roomId);
    const slot = (x: State) => Date.parse(x.room.phase_ends_at!) - Date.parse(x.room.track_started_at!);
    const firstIsLong = (await ownerOf(currentTrack(s))) === players[0];
    expect(slot(s)).toBe(firstIsLong ? 45000 : 20000);
    await expirePhase(roomId);
    await rpc(db, players[0], "advance_room", { p_room_id: roomId });
    s = await snapshot(players[0], roomId);
    expect(slot(s)).toBe(firstIsLong ? 20000 : 45000);
  });

  it("accepts votes only between track start and clip end plus the network tolerance", async () => {
    const { players, roomId } = await gameRoom(2);
    const s = await snapshot(players[0], roomId);
    const track = currentTrack(s);
    const owner = await ownerOf(track);
    const voter = players.find((p) => p !== owner)!;
    const cast = () => rpcError(db, voter, "cast_vote", { p_room_id: roomId, p_submission_id: track, p_score: 3 });
    expect(await cast()).toBe("track_not_started");
    await db.query(
      "update public.rooms set track_started_at = now() - interval '60 seconds', phase_ends_at = now() - interval '1 second' where id = $1",
      [roomId],
    );
    expect(await cast()).toBe("deadline_passed");
    await db.query(
      "update public.rooms set track_started_at = now() - interval '47 seconds', phase_ends_at = now() - interval '2 seconds' where id = $1",
      [roomId],
    );
    expect(await cast()).toBe("deadline_passed");
    await db.query(
      "update public.rooms set track_started_at = now() - interval '46 seconds', phase_ends_at = now() - interval '1 second' where id = $1",
      [roomId],
    );
    await rpc(db, voter, "cast_vote", { p_room_id: roomId, p_submission_id: track, p_score: 3 });
  });

  it("changing the listen cap in the lobby resets ready", async () => {
    const { players, roomId } = await roomWith(2);
    await rpc(db, players[1], "set_ready", { p_room_id: roomId, p_ready: true });
    await rpc(db, players[0], "update_room_settings", { p_room_id: roomId, p_listen_seconds: 60 });
    const s = await snapshot(players[0], roomId);
    expect(s.room.listen_seconds).toBe(60);
    expect(s.players.find((p) => p.user_id === players[1])!.is_ready).toBe(false);
  });
});

describe("skip", () => {
  type SkipResult = { skipped: boolean; votes: number; needed: number };
  const skip = (userId: string, roomId: string) => rpc<SkipResult>(db, userId, "skip_track", { p_room_id: roomId });

  it("checks eligibility and is idempotent", async () => {
    const { players, roomId } = await roomWith(4);
    const [outsider] = await users(1);
    expect(await rpcError(db, players[1], "skip_track", { p_room_id: roomId })).toBe("wrong_phase");
    await startGame(players[0], roomId);
    for (const p of players) await submit(p, roomId);
    const s = await snapshot(players[0], roomId);
    const owner = await ownerOf(currentTrack(s));
    const [first] = players.filter((p) => p !== owner);
    expect(await rpcError(db, outsider, "skip_track", { p_room_id: roomId })).toBe("not_member");

    expect(await skip(first, roomId)).toEqual({ skipped: false, votes: 1, needed: 3 });
    const version = (await snapshot(first, roomId)).version;
    expect(await skip(first, roomId)).toEqual({ skipped: false, votes: 1, needed: 3 });
    const after = await snapshot(first, roomId);
    expect(after.version).toBe(version);
    expect(after.skip).toEqual({ submission_id: currentTrack(s), votes: 1, needed: 3, you_voted: true });
    expect((await snapshot(owner, roomId)).skip!.you_voted).toBe(false);
    const payload = (await broadcasts(roomId, "room_state")).at(-1) as unknown as State;
    expect(payload.skip).toEqual({ submission_id: currentTrack(s), votes: 1, needed: 3 });
    expect(await skip(owner, roomId)).toEqual({ skipped: false, votes: 2, needed: 3 });
  });

  it.each([
    [2, 2],
    [3, 2],
    [4, 3],
    [5, 3],
    [10, 6],
  ])("with %i players it takes a majority of %i skip votes, the producer's included", async (n, needed) => {
    const { players, roomId } = await gameRoom(n, { p_max_players: 16 });
    const s = await snapshot(players[0], roomId);
    expect(s.skip!.needed).toBe(needed);
    const track = currentTrack(s);
    const owner = await ownerOf(track);
    const skippers = [owner, ...players.filter((p) => p !== owner)];
    for (let i = 0; i < needed - 1; i++) {
      expect((await skip(skippers[i], roomId)).skipped).toBe(false);
      expect((await snapshot(players[0], roomId)).room.current_track).toBe(0);
    }
    expect(await skip(skippers[needed - 1], roomId)).toMatchObject({ skipped: true, needed });
    const next = await snapshot(players[0], roomId);
    expect(next.room.current_track).toBe(1);
    expect(Date.parse(next.room.track_started_at!)).toBeGreaterThan(Date.now());
  });

  it("keeps ratings and goes to results when the last track is skipped", async () => {
    const { players, roomId } = await gameRoom(2);
    const [a, b] = players;
    for (let i = 0; i < 2; i++) {
      const s = await snapshot(a, roomId);
      const track = currentTrack(s);
      const owner = await ownerOf(track);
      const other = owner === a ? b : a;
      await beginPlayback(roomId);
      await db.query("update public.rooms set phase_ends_at = now() + interval '1 minute' where id = $1", [roomId]);
      await rpc(db, other, "cast_vote", { p_room_id: roomId, p_submission_id: track, p_score: 4 }).catch(() => undefined);
      if ((await snapshot(a, roomId)).room.current_track === i) {
        await skip(other, roomId);
        await skip(owner, roomId);
      }
    }
    expect((await snapshot(a, roomId)).room.status).toBe("listening");
    await expirePhase(roomId);
    await rpc(db, a, "advance_room", { p_room_id: roomId });
    await endReview(db, roomId);
    const s = await snapshot(a, roomId);
    expect(s.room.status).toBe("results");
    expect(s.results.map((r) => r.vote_count)).toEqual([1, 1]);
    expect(s.results.every((r) => r.avg_score === 4)).toBe(true);
  });
});

describe("member freshness", () => {
  it("touch_room refreshes last_seen_at for members only", async () => {
    const { players, roomId } = await roomWith(2);
    const [outsider] = await users(1);
    await makeStale(roomId, players[1]);
    await rpc(db, players[1], "touch_room", { p_room_id: roomId });
    const s = await snapshot(players[0], roomId);
    expect(Date.now() - Date.parse(s.players.find((p) => p.user_id === players[1])!.last_seen_at)).toBeLessThan(10000);
    expect(await rpcError(db, outsider, "touch_room", { p_room_id: roomId })).toBe("not_member");
  });

  it("sweeps idle lobby members with host handoff and closes empty lobbies", async () => {
    const { players, roomId } = await roomWith(3);
    const lonely = await roomWith(1);
    await makeStale(roomId, players[0]);
    await makeStale(lonely.roomId, lonely.players[0]);
    await db.query("select public.sweep_rooms()");
    const s = await snapshot(players[1], roomId);
    expect(s.room.host_id).toBe(players[1]);
    expect(s.players.find((p) => p.user_id === players[0])!.left_at).not.toBeNull();
    expect((await snapshot(lonely.players[0], lonely.roomId)).room.status).toBe("closed");
  });

  it("never removes idle members mid-game but stops waiting for them", async () => {
    const { players, roomId } = await roomWith(3);
    await startGame(players[0], roomId);
    await makeStale(roomId, players[2]);
    await db.query("select public.sweep_rooms()");
    await submit(players[0], roomId);
    await submit(players[1], roomId);
    const s = await snapshot(players[0], roomId);
    expect(s.room.status).toBe("listening");
    expect(s.players.every((p) => p.left_at === null)).toBe(true);
    const owner = await ownerOf(currentTrack(s));
    expect(s.current_votes!.eligible).toBe(players.filter((p) => p !== owner && p !== players[2]).length);
  });

  it("counts only fresh members for readiness and start", async () => {
    const { players, roomId } = await roomWith(3);
    await rpc(db, players[0], "set_ready", { p_room_id: roomId, p_ready: true });
    await rpc(db, players[1], "set_ready", { p_room_id: roomId, p_ready: true });
    await makeStale(roomId, players[2]);
    expect((await snapshot(players[0], roomId)).readiness).toEqual({ ready: 2, total: 2, all_ready: true, can_start: true });
    await rpc(db, players[0], "start_game", { p_room_id: roomId });
  });

  it("ranks quick match and the lobby list by fresh members", async () => {
    const ghostly = await roomWith(3);
    await makeStale(ghostly.roomId, ghostly.players[1]);
    await makeStale(ghostly.roomId, ghostly.players[2]);
    const lively = await roomWith(2);
    const dead = await roomWith(2);
    for (const p of dead.players) await makeStale(dead.roomId, p);

    const [me] = await users(1);
    const rooms = await rpc<{ id: string; player_count: number }[]>(db, me, "list_public_rooms");
    expect(rooms.map((r) => r.id)).toEqual([lively.roomId, ghostly.roomId]);
    expect(rooms.find((r) => r.id === ghostly.roomId)!.player_count).toBe(1);
    expect((await rpc<RoomRef>(db, me, "quick_match", { p_mode: "creative" })).room_id).toBe(lively.roomId);
  });
});

describe("hardening", () => {
  it("bumps the active room when a member renames", async () => {
    const { players, roomId } = await roomWith(2);
    const before = (await snapshot(players[0], roomId)).version;
    await asUser(db, players[1], (tx) =>
      tx.query("update public.profiles set username = 'renamed_one' where id = $1", [players[1]]),
    );
    const last = (await broadcasts(roomId, "room_state")).at(-1) as unknown as {
      version: number;
      players: { user_id: string; username: string }[];
    };
    expect(last.version).toBe(before + 1);
    expect(last.players.find((p) => p.user_id === players[1])!.username).toBe("renamed_one");
  });

  it("keeps sweeping other rooms when one fails", async () => {
    const broken = await roomWith(2);
    const healthy = await roomWith(2);
    for (const r of [broken, healthy]) {
      await startGame(r.players[0], r.roomId);
      await expirePhase(r.roomId);
    }
    await db.exec(`
      create function public.test_break_room() returns trigger language plpgsql as $$
      begin
        if new.id = '${broken.roomId}' and new.status <> old.status then raise exception 'boom'; end if;
        return new;
      end $$;
      create trigger test_break_room before update on public.rooms for each row execute function public.test_break_room();
    `);
    const { rows } = await db.query<{ n: number }>("select public.sweep_rooms() as n");
    expect(rows[0].n).toBe(1);
    expect((await snapshot(healthy.players[0], healthy.roomId)).room.status).toBe("results");
    expect((await snapshot(broken.players[0], broken.roomId)).room.status).toBe("producing");
  });
});

describe("premade window", () => {
  const update = (userId: string, roomId: string, changes: Record<string, unknown>) =>
    rpc(db, userId, "update_room_settings", { p_room_id: roomId, ...changes });
  const room = async (viewer: string, roomId: string) => (await snapshot(viewer, roomId)).room;
  const windowSeconds = (r: State["room"]) => (Date.parse(r.phase_ends_at!) - Date.now()) / 1000;

  it("creates premade rooms with a fixed 180s window, ignoring the produce param", async () => {
    const [host, other] = await users(2);
    const { room_id } = await createRoom(host, { p_mode: "premade", p_produce_seconds: 3600 });
    expect((await room(host, room_id)).produce_seconds).toBe(180);
    const odd = await createRoom(other, { p_mode: "premade", p_produce_seconds: 5 });
    expect((await room(other, odd.room_id)).produce_seconds).toBe(180);
  });

  it("pins 180 when switching to premade and ignores produce values there without resetting ready", async () => {
    const { players, roomId } = await roomWith(2, { p_produce_seconds: 600 });
    const [host, b] = players;
    await update(host, roomId, { p_mode: "premade", p_produce_seconds: 900 });
    expect((await room(host, roomId)).produce_seconds).toBe(180);

    await rpc(db, b, "set_ready", { p_room_id: roomId, p_ready: true });
    const before = await snapshot(host, roomId);
    await update(host, roomId, { p_produce_seconds: 1500 });
    await update(host, roomId, { p_produce_seconds: 1 });
    const after = await snapshot(host, roomId);
    expect(after.room.produce_seconds).toBe(180);
    expect(after.players.find((p) => p.user_id === b)!.is_ready).toBe(true);
    expect(after.version).toBe(before.version + 2);
  });

  it("restores 1200 when leaving premade unless a produce value comes with the switch", async () => {
    const { players, roomId } = await roomWith(2, { p_mode: "premade" });
    const [host, b] = players;
    await rpc(db, b, "set_ready", { p_room_id: roomId, p_ready: true });
    await update(host, roomId, { p_mode: "classic" });
    const s = await snapshot(host, roomId);
    expect(s.room).toMatchObject({ mode: "classic", produce_seconds: 1200 });
    expect(s.players.find((p) => p.user_id === b)!.is_ready).toBe(false);

    await update(host, roomId, { p_mode: "premade" });
    await update(host, roomId, { p_mode: "creative", p_produce_seconds: 300 });
    expect((await room(host, roomId)).produce_seconds).toBe(300);
  });

  it("starts premade rounds with 180s + 15s grace even if the column says otherwise", async () => {
    const { players, roomId } = await roomWith(2, { p_mode: "premade" });
    await db.query("update public.rooms set produce_seconds = 1200 where id = $1", [roomId]);
    await startGame(players[0], roomId);
    expect(windowSeconds(await room(players[0], roomId))).toBeCloseTo(195, 0);

    const classic = await roomWith(2, { p_mode: "classic", p_produce_seconds: 600 });
    await startGame(classic.players[0], classic.roomId);
    expect(windowSeconds(await room(classic.players[0], classic.roomId))).toBeCloseTo(615, 0);
  });

  it("estimates the end of a premade round from the 180s window", async () => {
    const { players, roomId } = await roomWith(3, { p_mode: "premade" });
    await startGame(players[0], roomId);
    const [viewer] = await users(1);
    const listed = (await rpc<{ id: string; estimated_end_at: string }[]>(db, viewer, "list_public_rooms")).find(
      (r) => r.id === roomId,
    )!;
    const expected = 180 + 15 + 3 * (3 + 45) + 60;
    expect((Date.parse(listed.estimated_end_at) - Date.now()) / 1000).toBeCloseTo(expected, 0);
  });

  it("gives quick-match premade rooms the 180s window", async () => {
    const [user] = await users(1);
    const { room_id } = await rpc<RoomRef & { created: boolean }>(db, user, "quick_match", { p_mode: "premade" });
    expect((await room(user, room_id)).produce_seconds).toBe(180);
    const [other] = await users(1);
    const creative = await rpc<RoomRef>(db, other, "quick_match", { p_mode: "creative" });
    expect((await room(other, creative.room_id)).produce_seconds).toBe(1200);
  });
});

describe("auto votes", () => {
  type VoteRow = { voter_id: string; score: number; is_default: boolean };
  const votesOn = async (submissionId: string) =>
    (
      await db.query<VoteRow>("select voter_id, score, is_default from public.votes where submission_id = $1", [
        submissionId,
      ])
    ).rows;
  const advance = (userId: string, roomId: string) => rpc(db, userId, "advance_room", { p_room_id: roomId });
  const endClipAgo = (roomId: string, seconds: number) =>
    db.query(
      `update public.rooms set track_started_at = now() - make_interval(secs => 45 + ${seconds}),
         phase_ends_at = now() - make_interval(secs => ${seconds}) where id = $1`,
      [roomId],
    );

  it("gives fresh non-voters a default 3 at clip end, never the producer or stale members", async () => {
    const { players, roomId } = await gameRoom(4);
    const track = currentTrack(await snapshot(players[0], roomId));
    const owner = await ownerOf(track);
    const [voter, silent, stale] = players.filter((p) => p !== owner);
    await vote(voter, roomId, track, 5);
    await makeStale(roomId, stale);
    await finishTrackPlayback(roomId);
    await advance(owner, roomId);

    const rows = await votesOn(track);
    expect(rows.find((r) => r.voter_id === voter)).toMatchObject({ score: 5, is_default: false });
    expect(rows.find((r) => r.voter_id === silent)).toMatchObject({ score: 3, is_default: true });
    expect(rows.map((r) => r.voter_id)).not.toContain(stale);
    expect(rows.map((r) => r.voter_id)).not.toContain(owner);
  });

  it("lets a vote landing 1s after clip end overwrite the default, but not at 2s", async () => {
    const { players, roomId } = await gameRoom(3);
    const track = currentTrack(await snapshot(players[0], roomId));
    const owner = await ownerOf(track);
    const [late, later] = players.filter((p) => p !== owner);
    await endClipAgo(roomId, 1);
    await advance(owner, roomId);
    expect((await snapshot(owner, roomId)).room.current_track).toBe(1);
    expect((await votesOn(track)).every((r) => r.is_default && r.score === 3)).toBe(true);

    await rpc(db, late, "cast_vote", { p_room_id: roomId, p_submission_id: track, p_score: 5 });
    expect((await votesOn(track)).find((r) => r.voter_id === late)).toMatchObject({ score: 5, is_default: false });

    await db.query("update public.rooms set closed_track_at = now() - interval '2 seconds' where id = $1", [roomId]);
    expect(await rpcError(db, later, "cast_vote", { p_room_id: roomId, p_submission_id: track, p_score: 5 })).toBe(
      "deadline_passed",
    );
  });

  it("applies defaults when a skip closes the track", async () => {
    const { players, roomId } = await gameRoom(3);
    const track = currentTrack(await snapshot(players[0], roomId));
    const owner = await ownerOf(track);
    const voters = players.filter((p) => p !== owner);
    await beginPlayback(roomId);
    for (const v of voters) await rpc(db, v, "skip_track", { p_room_id: roomId });
    expect((await snapshot(owner, roomId)).room.current_track).toBe(1);
    const rows = await votesOn(track);
    expect(rows.map((r) => r.voter_id).sort()).toEqual([...voters].sort());
    expect(rows.every((r) => r.score === 3 && r.is_default)).toBe(true);
  });

  it("holds the last track for the tolerance so late votes count in results", async () => {
    const { players, roomId } = await gameRoom(2);
    await expirePhase(roomId);
    await advance(players[0], roomId);
    const s = await snapshot(players[0], roomId);
    const last = currentTrack(s);
    const owner = await ownerOf(last);
    const voter = players.find((p) => p !== owner)!;
    await endClipAgo(roomId, 0.5);
    await advance(owner, roomId);
    const held = await snapshot(owner, roomId);
    expect(held.room.status).toBe("listening");
    await rpc(db, voter, "cast_vote", { p_room_id: roomId, p_submission_id: last, p_score: 1 });
    await expirePhase(roomId);
    await advance(owner, roomId);
    expect((await snapshot(owner, roomId)).room.status).toBe("reviewing");
    await endReview(db, roomId);
    const done = await snapshot(owner, roomId);
    expect(done.room.status).toBe("results");
    expect(done.results.find((r) => r.user_id === owner)).toMatchObject({ avg_score: 1, vote_count: 1 });
  });
});
