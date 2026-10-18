import { connection, NextResponse, type NextRequest } from "next/server";
import { LOUDNESS_BOOST_ENABLED } from "@/lib/features";
import { createAdminClient } from "@/lib/supabase/admin";
import { processSubmissionAudio } from "@/lib/tracks/process";
import { QUARANTINE_BUCKET, SUBMISSIONS_BUCKET, type AdminClient } from "@/lib/uploads/server";

export const maxDuration = 300;

const FINGERPRINT_BATCH = 10;
const LOUDNESS_BATCH = 3;

export async function GET(request: NextRequest) {
  await connection();
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse(null, { status: 404 });
  }
  const admin = createAdminClient();

  const stale = await admin.rpc("stale_quarantine_objects", { p_limit: 500 });
  const quarantined = (stale.data ?? []) as string[];
  if (quarantined.length > 0) await admin.storage.from(QUARANTINE_BUCKET).remove(quarantined);

  const due = await admin.rpc("submissions_due_for_purge", { p_limit: 500 });
  const expired = (due.data ?? []) as { submission_id: string; storage_path: string }[];
  if (expired.length > 0) {
    const removed = await admin.storage.from(SUBMISSIONS_BUCKET).remove(expired.map((s) => s.storage_path));
    if (!removed.error) {
      await admin.rpc("mark_submissions_purged", { p_ids: expired.map((s) => s.submission_id) });
    }
  }

  const orphaned = ((await admin.rpc("queued_submission_object_purges", { p_limit: 500 })).data ?? []) as string[];
  if (orphaned.length > 0) {
    const removed = await admin.storage.from(SUBMISSIONS_BUCKET).remove(orphaned);
    if (!removed.error) await admin.rpc("clear_submission_object_purges", { p_paths: orphaned });
  }

  const retry = await admin.rpc("fingerprint_retry_candidates", { p_limit: FINGERPRINT_BATCH });
  const pending = (retry.data ?? []) as { submission_id: string; storage_path: string }[];
  let fingerprinted = 0;
  for (const submission of pending) {
    const downloaded = await admin.storage.from(SUBMISSIONS_BUCKET).download(submission.storage_path);
    const bytes = downloaded.data ? new Uint8Array(await downloaded.data.arrayBuffer()) : null;
    const assigned = await processSubmissionAudio(admin, {
      submissionId: submission.submission_id,
      storagePath: submission.storage_path,
      bytes,
      ext: submission.storage_path.split(".").pop() ?? "bin",
    }).catch((error) => {
      console.error("track matching retry failed", error);
      return null;
    });
    if (assigned) fingerprinted++;
  }

  const measured = LOUDNESS_BOOST_ENABLED ? await measurePendingLoudness(admin) : 0;

  return NextResponse.json({
    quarantine: quarantined.length,
    purged: expired.length,
    orphaned: orphaned.length,
    fingerprinted,
    measured,
  });
}

async function measurePendingLoudness(admin: AdminClient) {
  const { recordSubmissionLoudness } = await import("@/lib/uploads/measure");
  const unmeasured = ((await admin.rpc("loudness_retry_candidates", { p_limit: LOUDNESS_BATCH })).data ?? []) as {
    submission_id: string;
    storage_path: string;
  }[];
  let measured = 0;
  for (const submission of unmeasured) {
    const downloaded = await admin.storage.from(SUBMISSIONS_BUCKET).download(submission.storage_path);
    const ok = await recordSubmissionLoudness(admin, {
      submissionId: submission.submission_id,
      storagePath: submission.storage_path,
      bytes: downloaded.data ? new Uint8Array(await downloaded.data.arrayBuffer()) : null,
      ext: submission.storage_path.split(".").pop() ?? "bin",
    }).catch((error) => {
      console.error("loudness retry failed", error);
      return false;
    });
    if (ok) measured++;
  }
  return measured;
}
