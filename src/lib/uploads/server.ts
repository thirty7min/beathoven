import "server-only";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const QUARANTINE_BUCKET = "quarantine";
export const SUBMISSIONS_BUCKET = "submissions";
export const AVATARS_BUCKET = "avatars";

export type AdminClient = ReturnType<typeof createAdminClient>;

const STATUS_BY_CODE: Record<string, number> = {
  not_authenticated: 401,
  upload_rate_limited: 429,
  file_too_large: 413,
  upload_not_found: 404,
  upload_not_pending: 409,
};

export function uploadError(code: string, status = STATUS_BY_CODE[code] ?? 400) {
  return NextResponse.json({ error: code }, { status });
}

export async function signedInUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user ? { supabase, userId: data.user.id } : null;
}

export function hashBlocklist(admin: AdminClient) {
  return async (sha256: string) => {
    const { data, error } = await admin.rpc("upload_hash_blocked", { p_sha256: sha256 });
    if (error) throw new Error(error.message);
    return data === true;
  };
}

export async function readCapped(request: Request, maxBytes: number): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
