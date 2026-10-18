export const GAME_ERROR_CODES = [
  "not_authenticated",
  "profile_missing",
  "room_not_found",
  "room_full",
  "room_closed",
  "not_member",
  "not_host",
  "wrong_phase",
  "not_enough_players",
  "not_all_ready",
  "room_in_progress",
  "invalid_mode",
  "invalid_settings",
  "invalid_name",
  "max_players_below_count",
  "profile_not_found",
  "code_generation_failed",
  "no_prompts",
  "deadline_passed",
  "invalid_duration",
  "invalid_path",
  "upload_missing",
  "not_current_track",
  "invalid_score",
  "self_vote",
  "already_voted",
  "track_not_started",
  "cannot_skip_own",
  "dev_tools_disabled",
  "no_idle_bot",
  "not_a_bot",
  "banned_from_room",
  "cannot_kick_self",
  "not_in_room",
  "not_enough_players_to_vote_kick",
  "unsupported_audio",
  "audio_too_long",
  "audio_too_short",
  "file_too_large",
  "corrupt_file",
  "unsupported_image",
  "blocked_file",
  "upload_rate_limited",
  "upload_not_verified",
  "invalid_avatar_url",
  "invalid_link",
  "unsafe_link",
  "link_shortener_not_allowed",
  "link_check_unavailable",
  "link_rate_limited",
  "track_not_found",
  "invalid_track_title",
  "cannot_merge_same_track",
  "cannot_split_only_submission",
  "suggestion_not_found",
  "invalid_message",
  "rate_limited",
] as const;

export type GameErrorCode = (typeof GAME_ERROR_CODES)[number] | "upload_failed" | "unknown";

export class GameError extends Error {
  constructor(
    readonly code: GameErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GameError";
  }
}

export function toGameError(error: { message?: string } | null | undefined): GameError {
  const message = error?.message ?? "unknown error";
  const code = (GAME_ERROR_CODES as readonly string[]).includes(message) ? (message as GameErrorCode) : "unknown";
  return new GameError(code, message);
}
