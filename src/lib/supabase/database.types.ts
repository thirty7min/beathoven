// Hand-written to match supabase/migrations. Replace with
// `supabase gen types typescript --linked > src/lib/supabase/database.types.ts`
// once a hosted project exists.

import type { DawSlug } from "@/lib/profile/daws";
import type { Genre } from "@/lib/game/genres";

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Table<Row, Required extends keyof Row = never> = {
  Row: Row;
  Insert: Partial<Row> & Pick<Row, Required>;
  Update: Partial<Row>;
  Relationships: [];
};

export type RoomMode = "classic" | "premade" | "creative";
export type RoomStatus = "lobby" | "producing" | "listening" | "reviewing" | "results" | "closed";
export type SampleCategory =
  | "kick"
  | "snare"
  | "hihat"
  | "clap"
  | "perc"
  | "808"
  | "synth"
  | "melody"
  | "loop"
  | "vocal"
  | "fx";

export type Database = {
  __InternalSupabase: { PostgrestVersion: "13" };
  public: {
    Tables: {
      profiles: Table<
        {
          id: string;
          username: string;
          display_name: string;
          onboarded_at: string | null;
          avatar_url: string | null;
          bio: string;
          daws: DawSlug[];
          link_url: string | null;
          wins: number;
          ties: number;
          games_played: number;
          is_bot: boolean;
          created_at: string;
          updated_at: string;
        },
        "id" | "username"
      >;
      prompts: Table<{ id: number; body: string; active: boolean; created_at: string }, "body">;
      samples: Table<
        {
          id: number;
          name: string;
          storage_path: string;
          category: SampleCategory;
          bpm: number | null;
          musical_key: string | null;
          duration_ms: number | null;
          license: string;
          active: boolean;
          created_at: string;
        },
        "name" | "storage_path" | "category"
      >;
      sample_recipe: Table<{ category: SampleCategory; count: number; position: number }, "category" | "count">;
      rooms: Table<
        {
          id: string;
          code: string;
          name: string;
          host_id: string | null;
          mode: RoomMode;
          genre: Genre;
          max_players: number;
          produce_seconds: number;
          /** @deprecated ignored by the server */
          vote_seconds: number;
          reveal_names: boolean;
          listen_seconds: number;
          is_private: boolean;
          status: RoomStatus;
          round: number;
          phase_started_at: string;
          phase_ends_at: string | null;
          track_order: string[];
          current_track: number | null;
          track_started_at: string | null;
          autostart_at: string | null;
          closed_track_id: string | null;
          closed_track_at: string | null;
          version: number;
          created_at: string;
          updated_at: string;
        },
        "code" | "name" | "mode"
      >;
      room_players: Table<
        {
          room_id: string;
          user_id: string;
          joined_at: string;
          left_at: string | null;
          last_seen_at: string;
          is_ready: boolean;
        },
        "room_id" | "user_id"
      >;
      room_assets: Table<
        {
          id: number;
          room_id: string;
          round: number;
          kind: "sample" | "prompt";
          sample_id: number | null;
          prompt_id: number | null;
          position: number;
        },
        "room_id" | "round" | "kind"
      >;
      submissions: Table<
        {
          id: string;
          room_id: string;
          round: number;
          user_id: string;
          storage_path: string;
          duration_ms: number;
          submitted_at: string;
          purged_at: string | null;
          track_id: string | null;
          match_source: "exact" | "fingerprint" | "manual" | null;
          match_score: number | null;
          confirmed: boolean;
          clip_start_ms: number | null;
          clip_end_ms: number | null;
          peaks: number[] | null;
          loudness_lufs: number | null;
          true_peak_dbtp: number | null;
          loudness_status: "pending" | "done" | "failed";
          loudness_attempts: number;
          loudness_boost: boolean;
        },
        "room_id" | "round" | "user_id" | "storage_path" | "duration_ms"
      >;
      votes: Table<
        {
          id: number;
          room_id: string;
          round: number;
          submission_id: string;
          voter_id: string;
          score: number;
          is_default: boolean;
          created_at: string;
        },
        "room_id" | "round" | "submission_id" | "voter_id" | "score"
      >;
      round_results: Table<
        {
          room_id: string;
          round: number;
          submission_id: string;
          user_id: string;
          avg_score: number | null;
          vote_count: number;
          rank: number;
          is_winner: boolean;
          finished_at: string;
        },
        "room_id" | "round" | "submission_id" | "user_id" | "vote_count" | "rank" | "is_winner"
      >;
      uploads: Table<
        {
          id: string;
          user_id: string;
          kind: "submission" | "avatar";
          room_id: string | null;
          round: number | null;
          status: "pending" | "verified" | "rejected";
          quarantine_path: string | null;
          final_path: string | null;
          mime: string | null;
          size: number | null;
          sha256: string | null;
          duration_ms: number | null;
          reject_reason: string | null;
          created_at: string;
        },
        "user_id" | "kind"
      >;
      chat_messages: Table<
        { id: number; room_id: string; user_id: string | null; body: string; kind: "user" | "system"; created_at: string },
        "room_id" | "body"
      >;
    };
    Views: { [_ in never]: never };
    Functions: {
      create_room: {
        Args: {
          p_mode: RoomMode;
          p_max_players?: number;
          p_produce_seconds?: number;
          p_vote_seconds?: number;
          p_is_private?: boolean;
          p_name?: string;
          p_reveal_names?: boolean;
          p_listen_seconds?: number;
          p_genre?: Genre;
        };
        Returns: Json;
      };
      skip_track: { Args: { p_room_id: string }; Returns: Json };
      kick_player: { Args: { p_room_id: string; p_user_id: string }; Returns: undefined };
      vote_kick: { Args: { p_room_id: string; p_target: string }; Returns: Json };
      dev_tools_enabled: { Args: Record<string, never>; Returns: boolean };
      dev_add_bot: { Args: { p_room_id: string }; Returns: Json };
      dev_remove_bot: { Args: { p_room_id: string; p_bot_id: string }; Returns: undefined };
      dev_register_bot: {
        Args: { p_user_id: string; p_storage_path: string; p_duration_ms: number };
        Returns: Json;
      };
      touch_room: { Args: { p_room_id: string }; Returns: undefined };
      room_heartbeat: { Args: Record<string, never>; Returns: Json };
      reserve_upload: { Args: { p_room_id: string | null; p_kind: "submission" | "avatar" }; Returns: Json };
      upload_hash_blocked: { Args: { p_sha256: string }; Returns: boolean };
      reject_upload: { Args: { p_upload_id: string; p_reason: string }; Returns: undefined };
      complete_upload: {
        Args: {
          p_upload_id: string;
          p_final_path: string;
          p_mime: string;
          p_size: number;
          p_sha256: string;
          p_duration_ms?: number | null;
        };
        Returns: Json;
      };
      clear_avatar: { Args: { p_user_id: string }; Returns: Json };
      claim_link_attempt: { Args: { p_user_id: string }; Returns: undefined };
      link_domain_blocked: { Args: { p_host: string }; Returns: boolean };
      set_profile_link: { Args: { p_user_id: string; p_url: string | null }; Returns: string | null };
      record_link_check: { Args: { p_url: string }; Returns: undefined };
      get_profile_link: { Args: { p_username: string }; Returns: Json };
      clear_unsafe_link: { Args: { p_user_id: string; p_url: string }; Returns: boolean };
      allowed_daws: { Args: Record<string, never>; Returns: string[] };
      register_submission_audio: {
        Args: { p_submission_id: string; p_storage_path: string; p_payload_sha256: string | null; p_title_hint: string | null };
        Returns: boolean;
      };
      track_match_context: { Args: { p_submission_id: string }; Returns: Json };
      assign_submission_track: {
        Args: {
          p_submission_id: string;
          p_storage_path: string;
          p_fingerprint: string | null;
          p_status: "done" | "failed";
          p_track_id?: string | null;
          p_score?: number | null;
          p_suggest_track_id?: string | null;
          p_suggest_score?: number | null;
        };
        Returns: Json;
      };
      fingerprint_retry_candidates: {
        Args: { p_limit?: number };
        Returns: { submission_id: string; storage_path: string }[];
      };
      rename_track: { Args: { p_track_id: string; p_title: string }; Returns: undefined };
      merge_tracks: { Args: { p_target: string; p_source: string }; Returns: undefined };
      split_submission: { Args: { p_submission_id: string }; Returns: string };
      confirm_track_suggestion: { Args: { p_submission_id: string }; Returns: string };
      dismiss_track_suggestion: { Args: { p_submission_id: string }; Returns: undefined };
      get_my_tracks: { Args: Record<string, never>; Returns: Json };
      get_profile_tracks: {
        Args: { p_username: string; p_sort?: "wins" | "win_rate" | "plays" | "recent"; p_limit?: number };
        Returns: Json;
      };
      stale_quarantine_objects: { Args: { p_limit?: number }; Returns: string[] };
      submissions_due_for_purge: {
        Args: { p_limit?: number };
        Returns: { submission_id: string; storage_path: string }[];
      };
      mark_submissions_purged: { Args: { p_ids: string[] }; Returns: undefined };
      queued_submission_object_purges: { Args: { p_limit?: number }; Returns: string[] };
      clear_submission_object_purges: { Args: { p_paths: string[] }; Returns: undefined };
      get_track_stream: { Args: { p_track_id: string; p_requester: string }; Returns: Json };
      record_submission_loudness: {
        Args: { p_submission_id: string; p_storage_path: string; p_ok: boolean; p_lufs?: number | null; p_true_peak?: number | null };
        Returns: boolean;
      };
      loudness_retry_candidates: { Args: { p_limit?: number }; Returns: { submission_id: string; storage_path: string }[] };
      quick_match: { Args: { p_mode: RoomMode; p_genre?: Genre }; Returns: Json };
      update_room_settings: {
        Args: {
          p_room_id: string;
          p_name?: string;
          p_max_players?: number;
          p_produce_seconds?: number;
          p_vote_seconds?: number;
          p_is_private?: boolean;
          p_mode?: RoomMode;
          p_reveal_names?: boolean;
          p_listen_seconds?: number;
          p_genre?: Genre;
        };
        Returns: undefined;
      };
      get_profile: { Args: { p_username: string }; Returns: Json };
      join_room: { Args: { p_code: string }; Returns: Json };
      leave_room: { Args: { p_room_id: string }; Returns: undefined };
      set_ready: { Args: { p_room_id: string; p_ready: boolean }; Returns: undefined };
      start_game: { Args: { p_room_id: string; p_force?: boolean }; Returns: undefined };
      submit_track: { Args: { p_room_id: string; p_upload_id: string }; Returns: Json };
      finish_review: { Args: { p_room_id: string }; Returns: Json };
      username_available: { Args: { p_username: string }; Returns: boolean };
      complete_onboarding: {
        Args: { p_display_name: string; p_username: string; p_bio?: string; p_daws?: string[] };
        Returns: Json;
      };
      confirm_submission: {
        Args: {
          p_room_id: string;
          p_clip_start_ms: number;
          p_clip_end_ms: number;
          p_peaks?: number[] | null;
          p_loudness_boost?: boolean | null;
        };
        Returns: Json;
      };
      set_submission_clip: {
        Args: {
          p_room_id: string;
          p_clip_start_ms: number;
          p_clip_end_ms: number;
          p_peaks?: number[] | null;
          p_loudness_boost?: boolean | null;
        };
        Returns: Json;
      };
      cast_vote: { Args: { p_room_id: string; p_submission_id: string; p_score: number }; Returns: undefined };
      send_chat: { Args: { p_room_id: string; p_body: string }; Returns: number };
      advance_room: { Args: { p_room_id: string }; Returns: Json };
      get_room_snapshot: { Args: { p_room_id: string }; Returns: Json };
      list_public_rooms: { Args: Record<string, never>; Returns: Json };
      server_time: { Args: Record<string, never>; Returns: string };
      is_room_member: { Args: { p_room_id: string }; Returns: boolean };
      is_active_room_member: { Args: { p_room_id: string }; Returns: boolean };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
