import { NextResponse, type NextRequest } from "next/server";
import type { Reservation } from "@/lib/game/rpc";
import { createAdminClient } from "@/lib/supabase/admin";
import { AVATARS_BUCKET, hashBlocklist, readCapped, signedInUser, uploadError } from "@/lib/uploads/server";
import { verifyUpload } from "@/lib/uploads/verify";

// Vercel rejects request bodies over 4.5MB before they reach the route.
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const caller = await signedInUser();
  if (!caller) return uploadError("not_authenticated");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_REQUEST_BYTES) return uploadError("file_too_large");
  const bytes = await readCapped(request, MAX_REQUEST_BYTES);
  if (!bytes) return uploadError("file_too_large");

  const reserved = await caller.supabase.rpc("reserve_upload", { p_room_id: null, p_kind: "avatar" });
  if (reserved.error) return uploadError(reserved.error.message);
  const { upload_id: uploadId } = reserved.data as Reservation;

  const admin = createAdminClient();
  const verdict = await verifyUpload("avatar", bytes, hashBlocklist(admin));
  if (!verdict.ok) {
    await admin.rpc("reject_upload", { p_upload_id: uploadId, p_reason: verdict.reason });
    return uploadError(verdict.reason, 422);
  }

  const avatars = admin.storage.from(AVATARS_BUCKET);
  const path = `${caller.userId}/${crypto.randomUUID()}.webp`;
  const stored = await avatars.upload(path, verdict.bytes, {
    contentType: verdict.mime,
    cacheControl: "31536000",
    upsert: false,
  });
  if (stored.error) {
    await admin.rpc("reject_upload", { p_upload_id: uploadId, p_reason: "storage_failed" });
    return uploadError("upload_failed", 502);
  }

  const completed = await admin.rpc("complete_upload", {
    p_upload_id: uploadId,
    p_final_path: path,
    p_mime: verdict.mime,
    p_size: verdict.bytes.byteLength,
    p_sha256: verdict.sha256,
  });
  if (completed.error) {
    await avatars.remove([path]);
    return uploadError(completed.error.message, 409);
  }
  const stale = (completed.data as { stale_paths: string[] }).stale_paths;
  if (stale.length > 0) await avatars.remove(stale);

  const { data: profile } = await caller.supabase.from("profiles").select("avatar_url").eq("id", caller.userId).single();
  return NextResponse.json({ avatarUrl: profile?.avatar_url ?? null });
}

export async function DELETE() {
  const caller = await signedInUser();
  if (!caller) return uploadError("not_authenticated");
  const admin = createAdminClient();
  const cleared = await admin.rpc("clear_avatar", { p_user_id: caller.userId });
  if (cleared.error) return uploadError(cleared.error.message, 500);
  const stale = (cleared.data as { stale_paths: string[] }).stale_paths;
  if (stale.length > 0) await admin.storage.from(AVATARS_BUCKET).remove(stale);
  return new NextResponse(null, { status: 204 });
}
