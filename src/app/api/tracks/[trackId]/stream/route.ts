import { createHash } from "node:crypto";
import { connection, NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SUBMISSIONS_BUCKET, signedInUser } from "@/lib/uploads/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STREAM_URL_SECONDS = 600;

const STATUS_BY_CODE: Record<string, number> = {
  invalid_request: 400,
  track_not_found: 404,
  track_not_playable: 403,
  stream_rate_limited: 429,
};

function respond(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

function streamError(code: string) {
  return respond({ error: code }, STATUS_BY_CODE[code] ?? 500);
}

async function requesterKey(request: NextRequest) {
  const caller = await signedInUser();
  if (caller) return `user:${caller.userId}`;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  return `ip:${createHash("sha256").update(ip).digest("hex")}`;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ trackId: string }> }) {
  await connection();
  const { trackId } = await params;
  if (!UUID.test(trackId)) return streamError("track_not_found");

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("get_track_stream", { p_track_id: trackId, p_requester: await requesterKey(request) });
  if (error) return streamError(error.message);
  const stream = data as { storage_path: string; loudness_lufs: number | null; true_peak_dbtp: number | null; loudness_boost: boolean };

  const signed = await admin.storage.from(SUBMISSIONS_BUCKET).createSignedUrl(stream.storage_path, STREAM_URL_SECONDS);
  if (signed.error) return streamError("unknown");
  return respond({
    url: signed.data.signedUrl,
    expiresAt: new Date(Date.now() + STREAM_URL_SECONDS * 1000).toISOString(),
    loudnessLufs: stream.loudness_lufs,
    truePeakDbtp: stream.true_peak_dbtp,
    loudnessBoost: stream.loudness_boost,
  });
}
