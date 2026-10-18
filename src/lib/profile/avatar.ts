import { GameError } from "@/lib/game/errors";
import { responseError, sendWithProgress, type UploadOptions } from "@/lib/game/storage";

const ENDPOINT = "/api/uploads/avatar";
const MAX_AVATAR_UPLOAD_BYTES = 4 * 1024 * 1024;

export async function uploadAvatar(blob: Blob, options: UploadOptions = {}): Promise<{ avatarUrl: string }> {
  if (blob.size > MAX_AVATAR_UPLOAD_BYTES) throw new GameError("file_too_large", "image is larger than 4MB");
  const body = await sendWithProgress(
    { method: "POST", url: ENDPOINT, headers: { "content-type": blob.type || "application/octet-stream" }, body: blob },
    options,
  );
  return JSON.parse(body) as { avatarUrl: string };
}

export async function removeAvatar(): Promise<void> {
  const response = await fetch(ENDPOINT, { method: "DELETE" });
  if (!response.ok) throw responseError(response.status, await response.text());
}
