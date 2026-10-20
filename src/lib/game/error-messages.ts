const MESSAGES: Record<string, string> = {
  not_authenticated: "You're signed out. Sign in and try again.",
  profile_missing: "Your profile isn't set up yet. Try signing in again.",
  room_not_found: "That room doesn't exist. Check the code and try again.",
  room_full: "That room is full.",
  room_closed: "That room has closed.",
  not_member: "You're not in this room anymore.",
  banned_from_room: "You were removed from this room.",
  not_host: "Only the host can do that.",
  wrong_phase: "The game moved on before that went through.",
  not_enough_players: "You need at least 2 players to start.",
  not_all_ready: "Not everyone is ready yet.",
  room_in_progress: "That room is mid-game. Try an open lobby.",
  invalid_name: "Room names can be up to 40 characters.",
  max_players_below_count: "There are already more players than that in the room.",
  profile_not_found: "That producer doesn't exist.",
  invalid_mode: "That game mode isn't available.",
  invalid_settings: "Those room settings aren't allowed.",
  code_generation_failed: "Couldn't create a room code. Please try again.",
  no_prompts: "There are no prompts available right now.",
  deadline_passed: "Too late, the timer already ran out.",
  invalid_duration: "Tracks must be between 1 second and 10 minutes long.",
  invalid_path: "That upload went to the wrong place. Please try again.",
  upload_missing: "Your upload didn't finish. Please try again.",
  upload_failed: "Upload failed. Check your connection and try again.",
  not_current_track: "Voting already moved to the next track.",
  invalid_score: "Ratings go from 1 to 5.",
  self_vote: "You can't rate your own track.",
  already_voted: "You already rated this track.",
  track_not_started: "Hang on, the track hasn't started yet.",
  cannot_skip_own: "You can't vote to skip your own track.",
  dev_tools_disabled: "Dev tools are off.",
  no_idle_bot: "No bot available right now.",
  not_a_bot: "That player isn't a bot.",
  cannot_kick_self: "You can't kick yourself.",
  not_in_room: "That player isn't in the room anymore.",
  not_enough_players_to_vote_kick: "Vote kicks need at least 3 players.",
  spectating: "You're spectating, so you can't do that.",
  spectators_full: "Too many people are watching this room right now.",
  not_a_player: "Spectators can only be removed by the host.",
  already_host: "You're already the host.",
  host_must_be_player: "Only players can be made host.",
  bot_cannot_host: "Bots can't be the host.",
  unsupported_audio: "That isn't a supported audio file. Use MP3, WAV, FLAC, OGG/Opus or M4A/AAC.",
  audio_too_long: "Tracks can be at most 15 minutes long.",
  audio_too_short: "Tracks must be at least 3 seconds long.",
  file_too_large: "That file is too large.",
  corrupt_file: "That file looks damaged. Try exporting it again.",
  unsupported_image: "Use a PNG, JPEG, WebP or GIF image.",
  blocked_file: "That file can't be uploaded.",
  upload_rate_limited: "Too many uploads. Try again in a little while.",
  upload_not_verified: "That upload didn't finish. Try again.",
  invalid_avatar_url: "Upload an image to set your avatar.",
  invalid_link: "Enter a public https:// link, up to 200 characters.",
  unsafe_link: "That link was flagged as unsafe, so it can't be added.",
  link_shortener_not_allowed: "Use the full link instead of a URL shortener.",
  link_check_unavailable: "Couldn't check that link right now. Try again in a minute.",
  link_rate_limited: "Too many link changes. Try again in a little while.",
  track_not_found: "That track doesn't exist anymore.",
  invalid_track_title: "Track titles need 1 to 80 characters.",
  cannot_merge_same_track: "Pick two different tracks to merge.",
  cannot_split_only_submission: "That's the only upload in this track, so there's nothing to split off.",
  suggestion_not_found: "That suggestion was already handled.",
  invalid_display_name: "Display names need 1 to 32 characters, with no hidden characters.",
  invalid_username: "Usernames need 3 to 24 letters, numbers or underscores.",
  invalid_bio: "Bios can be at most 500 characters.",
  invalid_daws: "Pick up to 3 different DAWs from the list.",
  username_taken: "That username is already taken.",
  invalid_clip: "Pick a part of the track between 10 seconds long and the room's listen time.",
  invalid_genre: "Pick a genre from the list.",
  invalid_peaks: "Couldn't save the waveform for that track.",
  track_not_playable: "This track can't be played right now.",
  stream_rate_limited: "Too many plays in a short time. Try again in a minute.",
  invalid_message: "Messages need 1 to 500 characters.",
  rate_limited: "Slow down a little. You're sending messages too fast.",
};

const POSTGRES_MESSAGES: Record<string, string> = {
  "23505": "That username is already taken.",
  "23514": "Some of those values aren't allowed.",
};

type ErrorLike = { code?: unknown; message?: unknown };

export function friendlyError(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (!error || typeof error !== "object") return fallback;
  const { code, message } = error as ErrorLike;
  if (typeof code === "string" && MESSAGES[code]) return MESSAGES[code];
  if (typeof message === "string" && MESSAGES[message]) return MESSAGES[message];
  if (typeof code === "string" && POSTGRES_MESSAGES[code]) return POSTGRES_MESSAGES[code];
  if (typeof message === "string" && /failed to fetch|network/i.test(message)) {
    return "Network problem. Check your connection and try again.";
  }
  return fallback;
}
