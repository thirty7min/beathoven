import type { DawSlug } from "@/lib/profile/daws";
import type { RoomMode, RoomStatus, SampleCategory } from "@/lib/supabase/database.types";
import type { Genre } from "./genres";

export type { RoomMode, RoomStatus, SampleCategory };

export type Room = {
  id: string;
  code: string;
  name?: string;
  host_id: string | null;
  mode: RoomMode;
  genre?: Genre;
  max_players: number;
  produce_seconds: number;
  /** @deprecated */
  vote_seconds: number;
  is_private: boolean;
  reveal_names?: boolean;
  listen_seconds?: number;
  status: RoomStatus;
  round: number;
  phase_started_at: string;
  phase_ends_at: string | null;
  track_order: string[];
  current_track: number | null;
  track_started_at: string | null;
  autostart_at?: string | null;
};

export type RoomPlayer = {
  user_id: string;
  username: string;
  display_name?: string;
  avatar_url: string | null;
  joined_at: string;
  left_at: string | null;
  last_seen_at?: string;
  is_ready: boolean;
  is_bot?: boolean;
};

export type SampleAsset = {
  id: number;
  name: string;
  storage_path: string;
  category: string;
  bpm: number | null;
  musical_key: string | null;
  duration_ms: number | null;
};

export type RoomAsset = {
  kind: "sample" | "prompt";
  position: number;
  prompt: string | null;
  sample: SampleAsset | null;
};

// Null while listening unless reveal_names; the room store restores your own from my_submission.
export type Submission = {
  id: string;
  user_id: string | null;
  storage_path: string;
  duration_ms: number;
  clip_start_ms?: number;
  clip_end_ms?: number;
  submitted_at: string | null;
} & Partial<PlaybackLoudness>;

export type PlaybackLoudness = { loudness_lufs: number | null; true_peak_dbtp: number | null; loudness_boost: boolean };

export type MySubmission = Submission & { confirmed: boolean; clip_start_ms: number; clip_end_ms: number };

export type VoteCast = { submission_id: string; voter_id: string };

export type RoundResult = {
  submission_id: string;
  user_id: string;
  avg_score: number | null;
  vote_count: number;
  rank: number;
  is_winner: boolean;
  clip_start_ms?: number;
  clip_end_ms?: number;
} & Partial<PlaybackLoudness>;

export type Readiness = { ready: number; total: number; all_ready: boolean; can_start: boolean };

export type CurrentVotes = { submission_id: string; count: number; eligible: number; voted_user_ids?: string[] };

export type KickVote = { target_user_id: string; votes: number; needed: number; expires_at: string };

export type SkipState = { submission_id: string; votes: number; needed: number; you_voted?: boolean };


export type ReviewState = { done_user_ids: string[]; total: number };

export type ReviewEntry = {
  submission_id: string;
  position: number;
  duration_ms: number;
  clip_start_ms: number;
  clip_end_ms: number;
  is_mine: boolean;
  my_vote: number | null;
  is_default: boolean;
} & Partial<PlaybackLoudness>;

export type RoomState = {
  version: number;
  room: Room;
  players: RoomPlayer[];
  assets: RoomAsset[];
  submissions: Submission[];
  votes_cast: VoteCast[];
  results: RoundResult[];
  readiness?: Readiness;
  submitted_user_ids?: string[];
  current_votes?: CurrentVotes | null;
  skip?: SkipState | null;
  kick_votes?: KickVote[];
  review?: ReviewState | null;
};

export type ChatMessage = {
  id: number;
  room_id: string;
  user_id: string | null;
  username: string | null;
  display_name?: string | null;
  body: string;
  kind?: "user" | "system";
  created_at: string;
};

export type MyVote = { submission_id: string; score: number };

export type RoomSnapshot = RoomState & {
  server_time: string;
  me: string;
  my_votes: MyVote[];
  chat: ChatMessage[];
  my_submission?: MySubmission | null;
  my_skip_votes?: string[];
  my_kick_votes?: string[];
  my_review?: ReviewEntry[] | null;
};

export type PresenceEntry = { user_id: string; online_at: string };

export type ProfileRoundResult = {
  room_name: string | null;
  mode: RoomMode;
  round: number;
  avg_score: number | null;
  vote_count: number;
  rank: number;
  entrants: number;
  is_winner: boolean;
  finished_at: string;
};

export type PublicProfile = {
  profile: {
    id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
    bio: string;
    daws: DawSlug[];
    link_url: string | null;
    wins: number;
    ties: number;
    games_played: number;
    created_at: string;
  };
  recent_results: ProfileRoundResult[];
};

export type PublicRoom = {
  id: string;
  code: string;
  mode: RoomMode;
  genre?: Genre;
  status: RoomStatus;
  max_players: number;
  player_count: number;
  host_username: string | null;
  host_display_name?: string | null;
  name: string;
  round: number;
  phase_ends_at: string | null;
  estimated_end_at: string | null;
  joinable: boolean;
  created_at: string;
};

export type ActiveRoom = Pick<
  PublicRoom,
  "id" | "code" | "name" | "mode" | "genre" | "status" | "max_players" | "player_count" | "host_username" | "host_display_name"
>;
