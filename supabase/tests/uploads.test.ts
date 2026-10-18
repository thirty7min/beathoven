import { beforeEach, describe, expect, it } from "vitest";
import { asService, asUser, createTestDb, createUser, rpc, rpcError, submitVerified, type TestDb } from "./harness";

const AVATAR_BASE = "https://ktdoekkxqcdtdmqyinlz.supabase.co/storage/v1/object/public/avatars/";

type Reservation = { upload_id: string; path: string | null };

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});

const users = (n: number) => Promise.all(Array.from({ length: n }, () => createUser(db)));

async function producingRoom(n = 2) {
  const players = await users(n);
  const room = await rpc<{ room_id: string; code: string }>(db, players[0], "create_room", { p_mode: "creative" });
  for (const p of players.slice(1)) await rpc(db, p, "join_room", { p_code: room.code });
  await rpc(db, players[0], "start_game", { p_room_id: room.room_id, p_force: true });
  return { players, roomId: room.room_id };
}

const reserve = (userId: string, roomId: string | null, kind: string) =>
  rpc<Reservation>(db, userId, "reserve_upload", { p_room_id: roomId, p_kind: kind });

const putObject = (userId: string, bucket: string, name: string) =>
  asUser(db, userId, (tx) =>
    tx.query("insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3)", [bucket, name, userId]),
  );

const readObjects = (userId: string, bucket: string) =>
  asUser(db, userId, async (tx) =>
    (await tx.query<{ name: string }>("select name from storage.objects where bucket_id = $1", [bucket])).rows.map(
      (r) => r.name,
    ),
  );

const serviceCall = <T>(sql: string, params: unknown[]) =>
  asService(db, async (tx) => (await tx.query<{ result: T }>(sql, params)).rows[0]?.result);

describe("reserve_upload", () => {
  it("reserves submissions only for active members while producing, and avatars for anyone signed in", async () => {
    const { players, roomId } = await producingRoom();
    const [outsider] = await users(1);
    const submission = await reserve(players[0], roomId, "submission");
    expect(submission.path).toBe(submission.upload_id);
    expect(await rpcError(db, outsider, "reserve_upload", { p_room_id: roomId, p_kind: "submission" })).toBe(
      "not_member",
    );
    expect((await reserve(outsider, null, "avatar")).path).toBeNull();
    expect(await rpcError(db, outsider, "reserve_upload", { p_room_id: null, p_kind: "script" })).toBe(
      "invalid_upload_kind",
    );
    await db.query("update public.rooms set status = 'listening' where id = $1", [roomId]);
    expect(await rpcError(db, players[0], "reserve_upload", { p_room_id: roomId, p_kind: "submission" })).toBe(
      "wrong_phase",
    );
  });

  it("rate-limits 20 audio and 10 avatar uploads per hour", async () => {
    const { players, roomId } = await producingRoom();
    const [a] = players;
    for (let i = 0; i < 20; i++) await reserve(a, roomId, "submission");
    expect(await rpcError(db, a, "reserve_upload", { p_room_id: roomId, p_kind: "submission" })).toBe(
      "upload_rate_limited",
    );
    for (let i = 0; i < 10; i++) await reserve(a, null, "avatar");
    expect(await rpcError(db, a, "reserve_upload", { p_room_id: null, p_kind: "avatar" })).toBe("upload_rate_limited");
    await db.query("update public.uploads set created_at = now() - interval '61 minutes'");
    await reserve(a, roomId, "submission");
  });

  it("lets clients read only their own upload rows and never write them", async () => {
    const { players, roomId } = await producingRoom();
    const [a, b] = players;
    const mine = await reserve(a, roomId, "submission");
    await reserve(b, roomId, "submission");
    const visible = await asUser(db, a, (tx) => tx.query<{ id: string }>("select id from public.uploads"));
    expect(visible.rows.map((r) => r.id)).toEqual([mine.upload_id]);
    for (const sql of [
      "update public.uploads set status = 'verified', final_path = 'x', duration_ms = 1",
      "insert into public.uploads (user_id, kind) values (auth.uid(), 'avatar')",
      "select * from public.blocked_hashes",
    ]) {
      await expect(asUser(db, a, (tx) => tx.query(sql))).rejects.toThrow(/permission denied/);
    }
    expect(await rpcError(db, a, "clear_avatar", { p_user_id: b })).toMatch(/permission denied/);
    expect(await rpcError(db, a, "reject_upload", { p_upload_id: mine.upload_id, p_reason: "x" })).toMatch(
      /permission denied/,
    );
    expect(
      await rpcError(db, a, "complete_upload", {
        p_upload_id: mine.upload_id,
        p_final_path: "x",
        p_mime: "audio/mpeg",
        p_size: 1,
        p_sha256: "ab",
      }),
    ).toMatch(/permission denied/);
  });
});

describe("storage policies", () => {
  it("accepts quarantine writes only at the caller's pending, fresh reservation", async () => {
    const { players, roomId } = await producingRoom();
    const [a, b] = players;
    const { path } = await reserve(a, roomId, "submission");
    await expect(putObject(b, "quarantine", path!)).rejects.toThrow(/row-level security/);
    await expect(putObject(a, "quarantine", crypto.randomUUID())).rejects.toThrow(/row-level security/);
    await putObject(a, "quarantine", path!);
    await expect(putObject(a, "quarantine", path!)).rejects.toThrow();
    expect(await readObjects(b, "quarantine")).toEqual([]);

    const rejected = await reserve(a, roomId, "submission");
    await serviceCall("select public.reject_upload($1, 'corrupt_file')", [rejected.upload_id]);
    await expect(putObject(a, "quarantine", rejected.path!)).rejects.toThrow(/row-level security/);

    const stale = await reserve(a, roomId, "submission");
    await db.query("update public.uploads set created_at = now() - interval '2 hours' where id = $1", [stale.upload_id]);
    await expect(putObject(a, "quarantine", stale.path!)).rejects.toThrow(/row-level security/);
  });

  it("gives clients no direct writes to submissions or avatars", async () => {
    const { players, roomId } = await producingRoom();
    const [a] = players;
    await expect(putObject(a, "submissions", `${roomId}/1/${crypto.randomUUID()}.mp3`)).rejects.toThrow(
      /row-level security/,
    );
    await expect(putObject(a, "avatars", `${a}/x.webp`)).rejects.toThrow(/row-level security/);
  });

  it("serves avatars to anyone", async () => {
    const [a] = await users(1);
    await asService(db, (tx) =>
      tx.query("insert into storage.objects (bucket_id, name) values ('avatars', $1)", [`${a}/face.webp`]),
    );
    const anon = await db.transaction(async (tx) => {
      await tx.exec("set local role anon");
      return (await tx.query("select name from storage.objects where bucket_id = 'avatars'")).rows;
    });
    expect(anon).toEqual([{ name: `${a}/face.webp` }]);
  });

  it("sets size and type limits on every upload bucket", async () => {
    const { rows } = await db.query<{ id: string; public: boolean; file_size_limit: number; allowed_mime_types: string[] }>(
      "select id, public, file_size_limit, allowed_mime_types from storage.buckets where id in ('quarantine', 'submissions', 'avatars') order by id",
    );
    expect(rows.map((r) => [r.id, r.public, Number(r.file_size_limit)])).toEqual([
      ["avatars", true, 262144],
      ["quarantine", false, 52428800],
      ["submissions", false, 52428800],
    ]);
    expect(rows.find((r) => r.id === "avatars")!.allowed_mime_types).toEqual(["image/webp"]);
    expect(rows.every((r) => r.allowed_mime_types.length > 0 && !r.allowed_mime_types.includes("image/svg+xml"))).toBe(
      true,
    );
  });
});

describe("verification results", () => {
  it("completes an avatar upload by setting avatar_url and returning the old object for deletion", async () => {
    const [a] = await users(1);
    const first = await reserve(a, null, "avatar");
    await serviceCall("select public.complete_upload($1, $2, 'image/webp', 900, 'aa')", [first.upload_id, `${a}/one.webp`]);
    const second = await reserve(a, null, "avatar");
    const result = await serviceCall<{ stale_paths: string[] }>(
      "select public.complete_upload($1, $2, 'image/webp', 900, 'bb') as result",
      [second.upload_id, `${a}/two.webp`],
    );
    expect(result.stale_paths).toEqual([`${a}/one.webp`]);
    const { rows } = await db.query<{ avatar_url: string }>("select avatar_url from public.profiles where id = $1", [a]);
    expect(rows[0].avatar_url).toBe(`${AVATAR_BASE}${a}/two.webp`);
    await expect(
      serviceCall("select public.complete_upload($1, 'x', 'image/webp', 1, 'cc')", [second.upload_id]),
    ).rejects.toThrow("upload_not_pending");

    const cleared = await serviceCall<{ stale_paths: string[] }>("select public.clear_avatar($1) as result", [a]);
    expect(cleared.stale_paths).toEqual([`${a}/two.webp`]);
    expect((await db.query("select avatar_url from public.profiles where id = $1", [a])).rows).toEqual([
      { avatar_url: null },
    ]);
  });

  it("reports blocked hashes case-insensitively", async () => {
    await db.query("insert into public.blocked_hashes (sha256) values ('deadbeef')");
    expect(await serviceCall<boolean>("select public.upload_hash_blocked('DEADBEEF') as result", [])).toBe(true);
    expect(await serviceCall<boolean>("select public.upload_hash_blocked('cafe') as result", [])).toBe(false);
  });
});

describe("profiles.avatar_url", () => {
  const setAvatar = (userId: string, url: string | null) =>
    asUser(db, userId, (tx) => tx.query("update public.profiles set avatar_url = $1 where id = $2", [url, userId]));

  it("accepts null or a webp in the user's own avatars folder", async () => {
    const [a] = await users(1);
    await setAvatar(a, `${AVATAR_BASE}${a}/3f2a-9c.webp`);
    await setAvatar(a, null);
  });

  it("rejects external hosts, other folders, other types and odd paths", async () => {
    const [a, b] = await users(2);
    for (const url of [
      "https://evil.example.com/a.webp",
      `https://evil.example.com/storage/v1/object/public/avatars/${a}/x.webp`,
      `${AVATAR_BASE}${b}/x.webp`,
      `${AVATAR_BASE}${a}/../${b}/x.webp`,
      `${AVATAR_BASE}${a}/x.svg`,
      `${AVATAR_BASE}${a}/x.webp?x=1`,
    ]) {
      await expect(setAvatar(a, url)).rejects.toThrow("invalid_avatar_url");
    }
  });

  it("grandfathers URLs set before the rule until they change", async () => {
    const [a] = await users(1);
    await db.query("alter table public.profiles disable trigger profiles_check_avatar_url_update");
    await db.query("update public.profiles set avatar_url = 'https://old.example.com/me.png' where id = $1", [a]);
    await db.query("alter table public.profiles enable trigger profiles_check_avatar_url_update");
    await asUser(db, a, (tx) => tx.query("update public.profiles set bio = 'still here' where id = $1", [a]));
    await db.query("update public.profiles set games_played = games_played + 1 where id = $1", [a]);
    await expect(setAvatar(a, "https://old.example.com/new.png")).rejects.toThrow("invalid_avatar_url");
  });
});

describe("hygiene", () => {
  it("expires stale pending and rejected uploads but keeps verified ones", async () => {
    const { players, roomId } = await producingRoom();
    const [a] = players;
    const pending = await reserve(a, roomId, "submission");
    const rejected = await reserve(a, roomId, "submission");
    await serviceCall("select public.reject_upload($1, 'corrupt_file')", [rejected.upload_id]);
    await submitVerified(db, a, roomId);
    const fresh = await reserve(a, roomId, "submission");
    await db.query("update public.uploads set created_at = now() - interval '2 hours' where id <> $1", [fresh.upload_id]);
    await db.query("select public.expire_uploads()");
    const { rows } = await db.query<{ id: string; status: string }>("select id, status from public.uploads order by status");
    expect(rows.map((r) => r.status).sort()).toEqual(["pending", "verified"]);
    expect(rows.map((r) => r.id)).not.toContain(pending.upload_id);
  });

  it("lists quarantine objects older than an hour and closed-room tracks past retention", async () => {
    const { players, roomId } = await producingRoom();
    const [a] = players;
    await asService(db, async (tx) => {
      await tx.query("insert into storage.objects (bucket_id, name, created_at) values ('quarantine', 'old', now() - interval '2 hours')");
      await tx.query("insert into storage.objects (bucket_id, name) values ('quarantine', 'new')");
    });
    const stale = await asService(db, async (tx) =>
      (await tx.query<{ name: string }>("select public.stale_quarantine_objects() as name")).rows.map((r) => r.name),
    );
    expect(stale).toEqual(["old"]);

    const submissionId = await submitVerified(db, a, roomId);
    const due = () =>
      asService(db, async (tx) => (await tx.query<{ submission_id: string }>("select * from public.submissions_due_for_purge()")).rows);
    expect(await due()).toEqual([]);
    await db.query("alter table public.rooms disable trigger rooms_touch");
    await db.query("update public.rooms set status = 'closed', updated_at = now() - interval '31 days' where id = $1", [roomId]);
    await db.query("alter table public.rooms enable trigger rooms_touch");
    expect((await due()).map((r) => r.submission_id)).toEqual([submissionId]);
    await serviceCall("select public.mark_submissions_purged($1)", [[submissionId]]);
    expect(await due()).toEqual([]);
  });
});
