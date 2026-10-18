import { getBrowserClient, type TypedSupabaseClient } from "@/lib/supabase/client";
import { supabaseEnv } from "@/lib/supabase/env";
import { MAX_SUBMISSION_BYTES, audioContentType } from "./audio-file";
import { GameError, toGameError } from "./errors";
import { reserveUpload } from "./rpc";

export { MAX_SUBMISSION_BYTES };

export const SUBMISSIONS_BUCKET = "submissions";
export const SAMPLES_BUCKET = "samples";
export const QUARANTINE_BUCKET = "quarantine";

export type UploadProgress = (fraction: number) => void;

export type UploadOptions = { onProgress?: UploadProgress; signal?: AbortSignal };
export type SubmissionUpload = { uploadId: string; submissionId: string; durationMs: number };

type XhrTarget = { method: "POST" | "PUT"; url: string; headers: Record<string, string>; body: Blob };

// XMLHttpRequest instead of fetch for upload progress events.
export function sendWithProgress(target: XhrTarget, { onProgress, signal }: UploadOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new GameError("upload_failed", "upload cancelled"));
    const xhr = new XMLHttpRequest();
    xhr.open(target.method, target.url);
    for (const [name, value] of Object.entries(target.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve(xhr.responseText);
      } else {
        reject(responseError(xhr.status, xhr.responseText));
      }
    };
    xhr.onerror = () => reject(new GameError("upload_failed", "network error during upload"));
    xhr.onabort = () => reject(new GameError("upload_failed", "upload cancelled"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(target.body);
  });
}

export function responseError(status: number, body: string): GameError {
  const message = storageErrorMessage(body) ?? `upload failed (${status})`;
  const error = toGameError({ message });
  return error.code === "unknown" ? new GameError(status === 413 ? "file_too_large" : "upload_failed", message) : error;
}

export async function uploadSubmission(roomId: string, file: File, options: UploadOptions = {}): Promise<SubmissionUpload> {
  if (file.size > MAX_SUBMISSION_BYTES) throw new GameError("file_too_large", "file is larger than 50MB");
  const contentType = audioContentType(file);
  if (!contentType) throw new GameError("unsupported_audio", "unsupported audio type");
  const supabase = getBrowserClient();
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new GameError("not_authenticated", "not signed in");

  const { upload_id: uploadId, path } = await reserveUpload(supabase, roomId, "submission");
  const { url, anonKey } = supabaseEnv();
  await sendWithProgress(
    {
      method: "POST",
      url: `${url}/storage/v1/object/${QUARANTINE_BUCKET}/${encodeURIComponent(path!)}`,
      headers: {
        authorization: `Bearer ${data.session.access_token}`,
        apikey: anonKey,
        "content-type": contentType,
        "x-upsert": "false",
      },
      body: file,
    },
    options,
  );

  const response = await fetch("/api/uploads/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ uploadId, fileName: file.name }),
    signal: options.signal,
  });
  const text = await response.text();
  if (!response.ok) throw responseError(response.status, text);
  return JSON.parse(text) as SubmissionUpload;
}

function storageErrorMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { message?: string; error?: string };
    return parsed.error ?? parsed.message ?? null;
  } catch {
    return null;
  }
}

export async function signedUrl(
  supabase: TypedSupabaseClient,
  bucket: string,
  path: string,
  expiresInSeconds = 600,
  download?: string,
) {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresInSeconds, download ? { download } : undefined);
  if (error) throw new GameError("unknown", error.message);
  return data.signedUrl;
}

export function readAudioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    const url = URL.createObjectURL(file);
    const done = () => URL.revokeObjectURL(url);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      done();
      if (Number.isFinite(audio.duration)) resolve(Math.round(audio.duration * 1000));
      else reject(new Error("could not read audio duration"));
    };
    audio.onerror = () => {
      done();
      reject(new Error("unsupported audio file"));
    };
    audio.src = url;
  });
}
