import { toGameError } from "@/lib/game/errors";
import type { RoomMode } from "@/lib/game/types";
import type { TypedSupabaseClient } from "@/lib/supabase/client";

export const TRACK_SORTS = ["wins", "win_rate", "plays", "recent"] as const;
export type TrackSort = (typeof TRACK_SORTS)[number];

export type ProfileTrack = {
  id: string;
  title: string;
  games: number;
  plays: number;
  wins: number;
  win_rate: number;
  avg_rating: number | null;
  best_finish: number;
  last_played_at: string;
  latest_submission_id: string | null;
  duration_ms: number | null;
  clip_start_ms: number | null;
  clip_end_ms: number | null;
  peaks: number[] | null;
  loudness_lufs: number | null;
  true_peak_dbtp: number | null;
  loudness_boost: boolean | null;
  playable: boolean;
};

export type TrackStream = {
  url: string;
  expiresAt: string;
  loudnessLufs: number | null;
  truePeakDbtp: number | null;
  loudnessBoost: boolean;
};

export type MatchSource = "exact" | "fingerprint" | "manual";

export type MyTrackSubmission = {
  id: string;
  submitted_at: string;
  duration_ms: number;
  mode: RoomMode;
  finished: boolean;
  match_source: MatchSource | null;
  match_score: number | null;
};

export type TrackSuggestion = {
  submission_id: string;
  track_id: string;
  track_title: string;
  score: number;
};

export type MyTrack = {
  id: string;
  title: string;
  title_edited: boolean;
  created_at: string;
  latest_submission_id: string | null;
  submissions: MyTrackSubmission[];
  suggestions: TrackSuggestion[];
};

function unwrap<T>({ data, error }: { data: unknown; error: { message: string } | null }): T {
  if (error) throw toGameError(error);
  return data as T;
}

export async function getProfileTracks(
  supabase: TypedSupabaseClient,
  username: string,
  options: { sort?: TrackSort; limit?: number } = {},
) {
  return unwrap<ProfileTrack[]>(
    await supabase.rpc("get_profile_tracks", { p_username: username, p_sort: options.sort, p_limit: options.limit }),
  );
}

export async function getMyTracks(supabase: TypedSupabaseClient) {
  return unwrap<MyTrack[]>(await supabase.rpc("get_my_tracks"));
}

export async function renameTrack(supabase: TypedSupabaseClient, trackId: string, title: string) {
  unwrap(await supabase.rpc("rename_track", { p_track_id: trackId, p_title: title }));
}

export async function mergeTracks(supabase: TypedSupabaseClient, targetId: string, sourceId: string) {
  unwrap(await supabase.rpc("merge_tracks", { p_target: targetId, p_source: sourceId }));
}

export async function splitSubmission(supabase: TypedSupabaseClient, submissionId: string) {
  return unwrap<string>(await supabase.rpc("split_submission", { p_submission_id: submissionId }));
}

export async function confirmTrackSuggestion(supabase: TypedSupabaseClient, submissionId: string) {
  return unwrap<string>(await supabase.rpc("confirm_track_suggestion", { p_submission_id: submissionId }));
}

export async function dismissTrackSuggestion(supabase: TypedSupabaseClient, submissionId: string) {
  unwrap(await supabase.rpc("dismiss_track_suggestion", { p_submission_id: submissionId }));
}

export async function getTrackStreamUrl(trackId: string, fetcher: typeof fetch = fetch): Promise<TrackStream> {
  const response = await fetcher(`/api/tracks/${encodeURIComponent(trackId)}/stream`, { cache: "no-store" });
  const body = (await response.json().catch(() => null)) as (TrackStream & { error?: string }) | null;
  if (!response.ok || !body?.url) throw toGameError({ message: body?.error ?? "unknown" });
  return {
    url: body.url,
    expiresAt: body.expiresAt,
    loudnessLufs: body.loudnessLufs ?? null,
    truePeakDbtp: body.truePeakDbtp ?? null,
    loudnessBoost: body.loudnessBoost ?? false,
  };
}
