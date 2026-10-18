import { needsSeek, type Playback } from "./phase";

export type AudioStatus = {
  paused: boolean;
  currentTimeMs: number;
  seeking: boolean;
  ready: boolean;
  buffering: boolean;
  msSinceSeek: number | null;
  msSinceStall: number | null;
};

export type AudioAction =
  | { type: "none" }
  | { type: "pause"; seekToMs: number | null }
  | { type: "play"; seekToMs: number | null };

const NONE: AudioAction = { type: "none" };

const END_GUARD_MS = 250;
// Re-seeking right after a seek discards the buffer and can loop forever on slow connections.
export const SEEK_BACKOFF_MS = 2_000;
export const STALL_TOLERANCE_MS = 1_500;
export const STALL_GRACE_MS = 10_000;

export function syncAudio(playback: Playback, audio: AudioStatus, toleranceMs = 300): AudioAction {
  switch (playback.state) {
    case "idle":
    case "ended":
      return audio.paused ? NONE : { type: "pause", seekToMs: null };
    case "pending": {
      const rewind = audio.currentTimeMs > 0 && audio.ready ? 0 : null;
      if (audio.paused && rewind === null) return NONE;
      return { type: "pause", seekToMs: rewind };
    }
    case "playing": {
      if (!audio.ready || audio.seeking) return NONE;
      if (!audio.paused && audio.buffering) return NONE;
      const expected = playback.offsetMs;
      const nearEnd = playback.clipMs - expected < END_GUARD_MS;
      const backingOff = audio.msSinceSeek !== null && audio.msSinceSeek < SEEK_BACKOFF_MS;
      const tolerance =
        audio.msSinceStall !== null && audio.msSinceStall < STALL_GRACE_MS ? Math.max(toleranceMs, STALL_TOLERANCE_MS) : toleranceMs;
      const seekToMs = !nearEnd && !backingOff && needsSeek(audio.currentTimeMs, expected, tolerance) ? expected : null;
      if (audio.paused) return nearEnd ? NONE : { type: "play", seekToMs };
      return seekToMs === null ? NONE : { type: "play", seekToMs };
    }
  }
}

export function seekPosition(fraction: number, clipMs: number): number {
  if (!Number.isFinite(fraction) || clipMs <= 0) return 0;
  return Math.min(1, Math.max(0, fraction)) * clipMs;
}

export function playbackProgress(playback: Playback): number {
  switch (playback.state) {
    case "playing":
      return playback.clipMs > 0 ? Math.min(1, playback.offsetMs / playback.clipMs) : 1;
    case "ended":
      return 1;
    default:
      return 0;
  }
}

export const FADE_OUT_MS = 300;

export function fadeGain(playback: Playback, fadeMs = FADE_OUT_MS): number {
  if (playback.state !== "playing" || playback.clipMs >= playback.submission.duration_ms) return 1;
  return Math.min(1, Math.max(0, (playback.clipMs - playback.offsetMs) / fadeMs));
}
