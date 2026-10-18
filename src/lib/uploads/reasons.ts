export const REJECT_REASONS = [
  "unsupported_audio",
  "audio_too_long",
  "audio_too_short",
  "file_too_large",
  "corrupt_file",
  "unsupported_image",
  "blocked_file",
] as const;

export type RejectReason = (typeof REJECT_REASONS)[number];

export type Rejected = { ok: false; reason: RejectReason };

export const reject = (reason: RejectReason): Rejected => ({ ok: false, reason });
