export const MAX_SUBMISSION_BYTES = 50 * 1024 * 1024;

export const MIN_TRACK_MS = 3_000;
export const MAX_TRACK_MS = 900_000;

/** Must match `allowed_mime_types` on the storage buckets. */
export const AUDIO_MIME_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/vnd.wave",
  "audio/flac",
  "audio/x-flac",
  "audio/aac",
  "audio/mp4",
  "audio/x-m4a",
  "audio/ogg",
] as const;

const MIME_BY_EXTENSION: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  wave: "audio/wav",
  flac: "audio/flac",
  aac: "audio/aac",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
};

export const AUDIO_ACCEPT = [...AUDIO_MIME_TYPES, ...Object.keys(MIME_BY_EXTENSION).map((ext) => `.${ext}`)].join(",");

type FileLike = { name: string; type: string; size: number };

function extension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

/**
 * Browsers often report an empty or nonstandard type for audio files (FLAC on
 * Windows, M4A in Firefox), and the bucket rejects anything off its list, so
 * fall back to the extension.
 */
export function audioContentType(file: Pick<FileLike, "name" | "type">): string | null {
  const type = file.type.toLowerCase();
  if ((AUDIO_MIME_TYPES as readonly string[]).includes(type)) return type;
  return MIME_BY_EXTENSION[extension(file.name)] ?? null;
}

export function validateAudioFile(file: FileLike): string | null {
  if (!audioContentType(file)) return "That isn't a supported audio file. Use MP3, WAV, FLAC, AAC/M4A or OGG.";
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_SUBMISSION_BYTES) return `That file is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_SUBMISSION_BYTES)}.`;
  return null;
}

export function validateDuration(ms: number): string | null {
  if (!Number.isFinite(ms) || ms < MIN_TRACK_MS) return "Tracks must be at least 3 seconds long.";
  if (ms > MAX_TRACK_MS) return "Tracks can be at most 15 minutes long.";
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, "0")}`;
}
