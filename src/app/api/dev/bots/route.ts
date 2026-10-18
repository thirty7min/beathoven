import { connection, NextResponse, type NextRequest } from "next/server";
import { placeholderWav } from "@/lib/game/placeholder-wav";
import { createAdminClient, devToolsAllowed } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const notFound = () => new NextResponse(null, { status: 404 });

function fail(error: string) {
  const status =
    error === "not_authenticated" ? 401 : error === "not_host" || error === "dev_tools_disabled" ? 403 : 400;
  return NextResponse.json({ error }, { status });
}

async function readIds<K extends string>(request: NextRequest, keys: K[]): Promise<Record<K, string> | null> {
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return null;
  const values = body as Record<string, unknown>;
  for (const key of keys) {
    const value = values[key];
    if (typeof value !== "string" || !UUID.test(value)) return null;
  }
  return values as Record<K, string>;
}

async function signedInClient() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user ? supabase : null;
}

async function createBot(): Promise<string | null> {
  const admin = createAdminClient();
  const id = crypto.randomUUID();
  const created = await admin.auth.admin.createUser({
    email: `bot-${id}@example.com`,
    email_confirm: true,
    user_metadata: { bot: true },
  });
  if (created.error || !created.data.user) return created.error?.message ?? "create_user_failed";
  const userId = created.data.user.id;

  const path = `bots/${id}.wav`;
  const { bytes, durationMs } = placeholderWav({ seed: Math.floor(Math.random() * 12) });
  const uploaded = await admin.storage.from("submissions").upload(path, bytes, { contentType: "audio/wav" });
  if (uploaded.error) {
    await admin.auth.admin.deleteUser(userId);
    return uploaded.error.message;
  }

  const registered = await admin.rpc("dev_register_bot", {
    p_user_id: userId,
    p_storage_path: path,
    p_duration_ms: durationMs,
  });
  if (registered.error) {
    await admin.storage.from("submissions").remove([path]);
    await admin.auth.admin.deleteUser(userId);
    return registered.error.message;
  }
  return null;
}

export async function GET() {
  await connection();
  if (!devToolsAllowed()) return notFound();
  const supabase = await signedInClient();
  if (!supabase) return NextResponse.json({ enabled: false });
  const { data } = await supabase.rpc("dev_tools_enabled");
  return NextResponse.json({ enabled: data === true });
}

export async function POST(request: NextRequest) {
  if (!devToolsAllowed()) return notFound();
  const ids = await readIds(request, ["roomId"]);
  if (!ids) return fail("invalid_request");
  const supabase = await signedInClient();
  if (!supabase) return fail("not_authenticated");

  let added = await supabase.rpc("dev_add_bot", { p_room_id: ids.roomId });
  if (added.error?.message === "no_idle_bot") {
    const error = await createBot();
    if (error) return NextResponse.json({ error }, { status: 500 });
    added = await supabase.rpc("dev_add_bot", { p_room_id: ids.roomId });
  }
  if (added.error) return fail(added.error.message);
  return NextResponse.json({ bot: added.data });
}

export async function DELETE(request: NextRequest) {
  if (!devToolsAllowed()) return notFound();
  const ids = await readIds(request, ["roomId", "botId"]);
  if (!ids) return fail("invalid_request");
  const supabase = await signedInClient();
  if (!supabase) return fail("not_authenticated");

  const { error } = await supabase.rpc("dev_remove_bot", { p_room_id: ids.roomId, p_bot_id: ids.botId });
  if (error) return fail(error.message);
  return new NextResponse(null, { status: 204 });
}
