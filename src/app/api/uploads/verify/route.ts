import { after, NextResponse, type NextRequest } from "next/server";
import type { SubmitResult } from "@/lib/game/rpc";
import { LOUDNESS_BOOST_ENABLED } from "@/lib/features";
import { createAdminClient } from "@/lib/supabase/admin";
import { processSubmissionAudio } from "@/lib/tracks/process";
import { defaultTrackTitle } from "@/lib/tracks/title";
import { MAX_AUDIO_BYTES } from "@/lib/uploads/audio";
import { reject } from "@/lib/uploads/reasons";
import {
  QUARANTINE_BUCKET,
  SUBMISSIONS_BUCKET,
  hashBlocklist,
  signedInUser,
  uploadError,
} from "@/lib/uploads/server";
import { verifyUpload } from "@/lib/uploads/verify";

export const maxDuration = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { uploadId?: unknown; fileName?: unknown } | null;
  const uploadId = typeof body?.uploadId === "string" && UUID.test(body.uploadId) ? body.uploadId : null;
  const fileName = typeof body?.fileName === "string" ? body.fileName.slice(0, 255) : null;
  if (!uploadId) return uploadError("invalid_request");
  const caller = await signedInUser();
  if (!caller) return uploadError("not_authenticated");

  const { data: upload } = await caller.supabase.from("uploads").select("*").eq("id", uploadId).maybeSingle();
  if (!upload || upload.kind !== "submission" || !upload.quarantine_path || !upload.room_id || upload.round === null) {
    return uploadError("upload_not_found");
  }
  if (upload.status !== "pending") return uploadError("upload_not_pending");

  const admin = createAdminClient();
  const quarantine = admin.storage.from(QUARANTINE_BUCKET);
  const downloaded = await quarantine.download(upload.quarantine_path);
  if (downloaded.error || !downloaded.data) return uploadError("upload_missing");

  try {
    const verdict =
      downloaded.data.size > MAX_AUDIO_BYTES
        ? reject("file_too_large")
        : await verifyUpload("submission", new Uint8Array(await downloaded.data.arrayBuffer()), hashBlocklist(admin));
    if (!verdict.ok || !("durationMs" in verdict)) {
      const reason = verdict.ok ? "unsupported_audio" : verdict.reason;
      await admin.rpc("reject_upload", { p_upload_id: uploadId, p_reason: reason });
      return uploadError(reason, 422);
    }

    const submissions = admin.storage.from(SUBMISSIONS_BUCKET);
    const finalPath = `${upload.room_id}/${upload.round}/${crypto.randomUUID()}.${verdict.ext}`;
    const stored = await submissions.upload(finalPath, verdict.bytes, { contentType: verdict.mime, upsert: false });
    if (stored.error) {
      await admin.rpc("reject_upload", { p_upload_id: uploadId, p_reason: "storage_failed" });
      return uploadError("upload_failed", 502);
    }

    const completed = await admin.rpc("complete_upload", {
      p_upload_id: uploadId,
      p_final_path: finalPath,
      p_mime: verdict.mime,
      p_size: verdict.bytes.byteLength,
      p_sha256: verdict.sha256,
      p_duration_ms: verdict.durationMs,
    });
    if (completed.error) {
      await submissions.remove([finalPath]);
      return uploadError(completed.error.message, 409);
    }

    const submitted = await caller.supabase.rpc("submit_track", { p_room_id: upload.room_id, p_upload_id: uploadId });
    if (submitted.error) {
      await submissions.remove([finalPath]);
      return uploadError(submitted.error.message, 409);
    }
    const result = submitted.data as SubmitResult;
    if (result.replaced_path) await submissions.remove([result.replaced_path]);
    after(() =>
      Promise.all([
        processSubmissionAudio(admin, {
          submissionId: result.submission_id,
          storagePath: finalPath,
          bytes: verdict.bytes,
          ext: verdict.ext,
          titleHint: defaultTrackTitle(verdict.title, fileName),
        }).catch((error) => console.error("track matching failed", error)),
        LOUDNESS_BOOST_ENABLED &&
          import("@/lib/uploads/measure")
            .then(({ recordSubmissionLoudness }) =>
              recordSubmissionLoudness(admin, {
                submissionId: result.submission_id,
                storagePath: finalPath,
                bytes: verdict.bytes,
                ext: verdict.ext,
              }),
            )
            .catch((error) => console.error("loudness measurement failed", error)),
      ]),
    );
    return NextResponse.json({ uploadId, submissionId: result.submission_id, durationMs: verdict.durationMs });
  } finally {
    await quarantine.remove([upload.quarantine_path]);
  }
}
