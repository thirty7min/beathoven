import type { MyTrack, TrackSort } from "@/lib/tracks/api";

export const TRACK_SORT_LABELS: Record<TrackSort, string> = {
  wins: "Most wins",
  win_rate: "Win rate",
  plays: "Most plays",
  recent: "Recently played",
};

export function formatWinRate(rate: number | string | null): string {
  const value = typeof rate === "string" ? Number(rate) : rate;
  return value === null || !Number.isFinite(value) ? "–" : `${Math.round(value * 100)}%`;
}

export function ordinal(rank: number): string {
  if (!Number.isFinite(rank) || rank < 1) return "–";
  const lastTwo = rank % 100;
  const suffix = lastTwo >= 11 && lastTwo <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[rank % 10] ?? "th";
  return `${rank}${suffix}`;
}

export type SuggestionView = {
  submissionId: string;
  submittedAt: string | null;
  fromTrackId: string;
  fromTitle: string;
  toTrackId: string;
  toTitle: string;
  score: number;
};

export function suggestionViews(tracks: MyTrack[]): SuggestionView[] {
  return tracks.flatMap((track) =>
    track.suggestions
      .filter((s) => s.track_id !== track.id)
      .map((s) => ({
        submissionId: s.submission_id,
        submittedAt: track.submissions.find((sub) => sub.id === s.submission_id)?.submitted_at ?? null,
        fromTrackId: track.id,
        fromTitle: track.title,
        toTrackId: s.track_id,
        toTitle: s.track_title,
        score: s.score,
      })),
  );
}

export function mergeTargets(tracks: MyTrack[], sourceId: string): MyTrack[] {
  return tracks.filter((t) => t.id !== sourceId);
}

export function canSplit(track: MyTrack | undefined): boolean {
  return (track?.submissions.length ?? 0) > 1;
}

export const STREAM_REFRESH_MARGIN_MS = 30_000;

export function streamUsable(expiresAt: string | null | undefined, now: number): boolean {
  const expires = expiresAt ? Date.parse(expiresAt) : NaN;
  return Number.isFinite(expires) && expires - now > STREAM_REFRESH_MARGIN_MS;
}

function clock(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, "0")}`;
}

export function trackTimeLabel(durationMs: number | null | undefined, progress: number | null): string | null {
  if (!durationMs || durationMs <= 0) return null;
  if (progress === null) return clock(durationMs);
  return `${clock(Math.min(1, Math.max(0, progress)) * durationMs)} / ${clock(durationMs)}`;
}
