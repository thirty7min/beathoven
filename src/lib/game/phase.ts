import type { Room, Submission } from "./types";

// Must match the constants in supabase/migrations/*_state_machine.sql.
export const UPLOAD_GRACE_MS = 15_000;
export const TRACK_LEAD_IN_MS = 3_000;
export const RESULTS_MS = 30_000;
export const REVIEW_MS = 30_000;
export const AUTOSTART_SECONDS = 5;

type TimedRoom = Pick<Room, "status" | "phase_ends_at" | "track_order" | "current_track" | "track_started_at"> & {
  listen_seconds?: number | null;
  produce_seconds?: number;
};

const parse = (iso: string | null) => (iso === null ? null : Date.parse(iso));

export function remainingMs(deadline: number | null, serverNow: number): number | null {
  return deadline === null ? null : Math.max(0, deadline - serverNow);
}

// The client's server-clock estimate can trail the server by up to rtt/2, so an uncapped countdown opens one second high.
export function cappedRemaining(endsAt: number, serverNow: number, maxMs = Infinity): number {
  return Math.min(maxMs, Math.max(0, endsAt - serverNow));
}

type ClipSource = Pick<Submission, "duration_ms" | "clip_start_ms" | "clip_end_ms">;

export function clipStartMs(submission: ClipSource): number {
  return submission.clip_start_ms ?? 0;
}

export function clipMs(limitSeconds: number | null | undefined, submission: ClipSource): number {
  const limit = limitSeconds && limitSeconds > 0 ? limitSeconds * 1000 : Infinity;
  const start = clipStartMs(submission);
  const end = submission.clip_end_ms ?? Math.min(submission.duration_ms, limit);
  return Math.max(0, Math.min(end - start, limit));
}

export function currentSubmission(room: TimedRoom, submissions: Submission[]): Submission | null {
  if (room.status !== "listening" || room.current_track === null) return null;
  const id = room.track_order[room.current_track];
  return submissions.find((s) => s.id === id) ?? null;
}

export type CountdownLabel = "produce" | "upload" | "starting" | "track" | "review" | "results";
export type Countdown = { label: CountdownLabel; endsAt: number; remainingMs: number };

export function phaseCountdown(room: TimedRoom, submissions: Submission[], serverNow: number): Countdown | null {
  const phaseEnd = parse(room.phase_ends_at);
  if (phaseEnd === null) return null;
  const make = (label: CountdownLabel, endsAt: number, maxMs = Infinity): Countdown => ({
    label,
    endsAt,
    remainingMs: cappedRemaining(endsAt, serverNow, maxMs),
  });

  switch (room.status) {
    case "producing": {
      const produceEnd = phaseEnd - UPLOAD_GRACE_MS;
      const produceMs = room.produce_seconds ? room.produce_seconds * 1000 : Infinity;
      return serverNow < produceEnd ? make("produce", produceEnd, produceMs) : make("upload", phaseEnd, UPLOAD_GRACE_MS);
    }
    case "listening": {
      const start = parse(room.track_started_at);
      const track = currentSubmission(room, submissions);
      if (start === null || !track) return make("track", phaseEnd);
      if (serverNow < start) return make("starting", start, TRACK_LEAD_IN_MS);
      const clip = clipMs(room.listen_seconds, track);
      return make("track", start + clip, clip);
    }
    case "reviewing":
      return make("review", phaseEnd, REVIEW_MS);
    case "results":
      return make("results", phaseEnd, RESULTS_MS);
    default:
      return null;
  }
}

export type Playback =
  | { state: "idle" }
  | { state: "pending"; submission: Submission; clipStartMs: number; clipMs: number; startsInMs: number }
  | { state: "playing"; submission: Submission; clipStartMs: number; clipMs: number; offsetMs: number }
  | { state: "ended"; submission: Submission; clipStartMs: number; clipMs: number };

export function playbackPosition(room: TimedRoom, submissions: Submission[], serverNow: number): Playback {
  const submission = currentSubmission(room, submissions);
  const start = parse(room.track_started_at);
  if (!submission || start === null) return { state: "idle" };
  const clip = { clipStartMs: clipStartMs(submission), clipMs: clipMs(room.listen_seconds, submission) };
  const offsetMs = serverNow - start;
  if (offsetMs < 0) return { state: "pending", submission, ...clip, startsInMs: -offsetMs };
  if (offsetMs >= clip.clipMs) return { state: "ended", submission, ...clip };
  return { state: "playing", submission, ...clip, offsetMs };
}

export function needsSeek(actualMs: number, expectedMs: number, toleranceMs = 300): boolean {
  return Math.abs(actualMs - expectedMs) > toleranceMs;
}

export function autostartRemainingMs(room: Pick<Room, "status" | "autostart_at">, serverNow: number): number | null {
  if (room.status !== "lobby") return null;
  const startsAt = parse(room.autostart_at ?? null);
  return startsAt === null ? null : cappedRemaining(startsAt, serverNow, AUTOSTART_SECONDS * 1000);
}

export function advanceDueAt(room: Pick<Room, "status" | "phase_ends_at" | "autostart_at">): number | null {
  if (room.status === "lobby") return parse(room.autostart_at ?? null);
  if (room.status !== "producing" && room.status !== "listening" && room.status !== "reviewing" && room.status !== "results") {
    return null;
  }
  return parse(room.phase_ends_at);
}

export function formatCountdown(ms: number): string {
  const totalSeconds = Math.ceil(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
