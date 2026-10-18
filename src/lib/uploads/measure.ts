import "server-only";
import { decodeAudio } from "./decode";
import { LoudnessMeter, type Loudness } from "./loudness";
import type { AdminClient } from "./server";

export async function measureAudioLoudness(bytes: Uint8Array, ext: string): Promise<Loudness> {
  let meter: LoudnessMeter | null = null;
  const { gainDb } = await decodeAudio(bytes, ext, (channelData, sampleRate) => {
    meter ??= new LoudnessMeter(sampleRate, channelData.length);
    if (meter.sampleRate === sampleRate) meter.push(channelData);
  });
  const result = (meter as LoudnessMeter | null)?.result() ?? { lufs: null, truePeakDbtp: null };
  return {
    lufs: result.lufs === null ? null : result.lufs + gainDb,
    truePeakDbtp: result.truePeakDbtp === null ? null : result.truePeakDbtp + gainDb,
  };
}

export type LoudnessJob = { submissionId: string; storagePath: string; bytes: Uint8Array | null; ext: string };

export async function recordSubmissionLoudness(admin: AdminClient, job: LoudnessJob): Promise<boolean> {
  const measured = job.bytes ? await measureAudioLoudness(job.bytes, job.ext).catch(() => null) : null;
  const { data, error } = await admin.rpc("record_submission_loudness", {
    p_submission_id: job.submissionId,
    p_storage_path: job.storagePath,
    p_ok: measured !== null,
    p_lufs: measured?.lufs ?? null,
    p_true_peak: measured?.truePeakDbtp ?? null,
  });
  if (error) throw new Error(error.message);
  return data === true && measured !== null;
}
