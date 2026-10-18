import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite, type Transaction } from "@electric-sql/pglite";

const testsDir = fileURLToPath(new URL(".", import.meta.url));
const supabaseDir = join(testsDir, "..");

export async function createTestDb() {
  const db = new PGlite();
  await db.exec(readFileSync(join(testsDir, "stubs.sql"), "utf8"));
  const migrationsDir = join(supabaseDir, "migrations");
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await db.exec(readFileSync(join(migrationsDir, file), "utf8"));
    } catch (error) {
      throw new Error(`migration ${file} failed: ${(error as Error).message}`);
    }
  }
  return db;
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>;

export async function createUser(db: TestDb, email?: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "insert into auth.users (email) values ($1) returning id",
    [email ?? null],
  );
  return rows[0].id;
}

export async function asUser<T>(
  db: TestDb,
  userId: string | null,
  fn: (tx: Transaction) => Promise<T>,
  settings: Record<string, string> = {},
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
    for (const [key, value] of Object.entries(settings)) {
      await tx.query("select set_config($1, $2, true)", [key, value]);
    }
    await tx.exec("set local role authenticated");
    return fn(tx);
  });
}

export async function rpc<T = unknown>(
  db: TestDb,
  userId: string | null,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const names = Object.keys(args);
  const params = names.map((name, i) => `${name} => $${i + 1}`).join(", ");
  return asUser(db, userId, async (tx) => {
    const { rows } = await tx.query<{ result: T }>(
      `select public.${fn}(${params}) as result`,
      names.map((name) => args[name]),
    );
    return rows[0].result;
  });
}

export async function rpcError(
  db: TestDb,
  userId: string | null,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<string> {
  try {
    await rpc(db, userId, fn, args);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error(`expected ${fn} to fail`);
}

export async function asService<T>(db: TestDb, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec("set local role service_role");
    return fn(tx);
  });
}

export async function verifiedUpload(db: TestDb, userId: string, roomId: string, durationMs = 60000) {
  const { upload_id: uploadId } = await rpc<{ upload_id: string }>(db, userId, "reserve_upload", {
    p_room_id: roomId,
    p_kind: "submission",
  });
  const { rows } = await db.query<{ round: number }>("select round from public.uploads where id = $1", [uploadId]);
  const finalPath = `${roomId}/${rows[0].round}/${crypto.randomUUID()}.mp3`;
  await asService(db, async (tx) => {
    await tx.query("insert into storage.objects (bucket_id, name) values ('submissions', $1)", [finalPath]);
    await tx.query("select public.complete_upload($1, $2, 'audio/mpeg', 1000, 'ab', $3)", [uploadId, finalPath, durationMs]);
  });
  return { uploadId, finalPath };
}

export async function submitVerified(
  db: TestDb,
  userId: string,
  roomId: string,
  durationMs = 60000,
  { confirm = true }: { confirm?: boolean } = {},
) {
  const { uploadId } = await verifiedUpload(db, userId, roomId, durationMs);
  const result = await rpc<{ submission_id: string }>(db, userId, "submit_track", {
    p_room_id: roomId,
    p_upload_id: uploadId,
  });
  if (confirm) await confirmDefaultClip(db, userId, roomId, durationMs);
  return result.submission_id;
}

export async function confirmDefaultClip(db: TestDb, userId: string, roomId: string, durationMs: number) {
  const { rows } = await db.query<{ listen_seconds: number }>("select listen_seconds from public.rooms where id = $1", [roomId]);
  return rpc(db, userId, "confirm_submission", {
    p_room_id: roomId,
    p_clip_start_ms: 0,
    p_clip_end_ms: Math.min(durationMs, rows[0].listen_seconds * 1000),
  });
}

export async function endReview(db: TestDb, roomId: string) {
  await db.query("update public.rooms set phase_ends_at = now() - interval '1 second' where id = $1 and status = 'reviewing'", [roomId]);
  await db.query("select public.sweep_rooms()");
}
