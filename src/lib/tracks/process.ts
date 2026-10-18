import "server-only";
import type { AdminClient } from "@/lib/uploads/server";
import { sha256Hex } from "@/lib/uploads/verify";
import { chooseTrack, decodeFingerprint, encodeFingerprint, type TrackChoice } from "./fingerprint-match";
import { FpcalcUnavailableError, fingerprintAudio } from "./fpcalc";

export type SubmissionAudio = {
  submissionId: string;
  storagePath: string;
  bytes: Uint8Array | null;
  ext: string;
  titleHint?: string | null;
};

export type TrackAssignment = { track_id: string; match_source: "exact" | "fingerprint" | "manual" | null };

type MatchContext = {
  storage_path: string;
  duration_ms: number;
  candidates: { track_id: string; duration_ms: number; fingerprint: string }[];
};

let warnedMissingFpcalc = false;

async function tryFingerprint(bytes: Uint8Array, ext: string) {
  try {
    return await fingerprintAudio(bytes, ext);
  } catch (error) {
    if (!(error instanceof FpcalcUnavailableError)) console.error("fingerprinting failed", error);
    else if (!warnedMissingFpcalc) {
      warnedMissingFpcalc = true;
      console.warn("fpcalc is not installed; tracks are matched by exact file hash only.");
    }
    return null;
  }
}

async function chooseFor(admin: AdminClient, audio: SubmissionAudio, fingerprint: Uint32Array): Promise<TrackChoice | null> {
  const context = await admin.rpc("track_match_context", { p_submission_id: audio.submissionId });
  if (context.error) throw new Error(context.error.message);
  const ctx = context.data as MatchContext | null;
  if (!ctx || ctx.storage_path !== audio.storagePath) return null;
  return chooseTrack(
    fingerprint,
    ctx.duration_ms,
    ctx.candidates.map((c) => ({ trackId: c.track_id, durationMs: c.duration_ms, fingerprint: decodeFingerprint(c.fingerprint) })),
  );
}

export async function processSubmissionAudio(admin: AdminClient, audio: SubmissionAudio): Promise<TrackAssignment | null> {
  const registered = await admin.rpc("register_submission_audio", {
    p_submission_id: audio.submissionId,
    p_storage_path: audio.storagePath,
    p_payload_sha256: audio.bytes ? sha256Hex(audio.bytes) : null,
    p_title_hint: audio.titleHint ?? null,
  });
  if (registered.error) throw new Error(registered.error.message);
  if (!registered.data) return null;

  const fingerprint = audio.bytes ? await tryFingerprint(audio.bytes, audio.ext) : null;
  const choice = fingerprint ? await chooseFor(admin, audio, fingerprint) : { match: null, suggestion: null };
  if (!choice) return null;

  const assigned = await admin.rpc("assign_submission_track", {
    p_submission_id: audio.submissionId,
    p_storage_path: audio.storagePath,
    p_fingerprint: fingerprint ? encodeFingerprint(fingerprint) : null,
    p_status: fingerprint ? "done" : "failed",
    p_track_id: choice.match?.trackId ?? null,
    p_score: choice.match?.ber ?? null,
    p_suggest_track_id: choice.suggestion?.trackId ?? null,
    p_suggest_score: choice.suggestion?.ber ?? null,
  });
  if (assigned.error) throw new Error(assigned.error.message);
  return assigned.data as TrackAssignment | null;
}
