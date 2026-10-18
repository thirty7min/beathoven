import type { TypedSupabaseClient } from "@/lib/supabase/client";
import { toGameError } from "./errors";
import type { PublicProfile, PublicRoom, RoomMode, RoomSnapshot } from "./types";

export type RoomRef = { room_id: string; code: string; version: number };
export type QuickMatchResult = RoomRef & { created: boolean };
export type AdvanceResult = { advanced: boolean; version: number };
export type SkipResult = { skipped: boolean; votes: number; needed: number };
export type KickResult = { kicked: boolean; votes: number; needed: number };

export type RoomSettings = {
  maxPlayers?: number;
  produceSeconds?: number;
  /** @deprecated */
  voteSeconds?: number;
  isPrivate?: boolean;
  revealNames?: boolean;
  listenSeconds?: number;
  name?: string;
};

function unwrap<T>({ data, error }: { data: unknown; error: { message: string } | null }): T {
  if (error) throw toGameError(error);
  return data as T;
}

export async function createRoom(supabase: TypedSupabaseClient, mode: RoomMode, settings: RoomSettings = {}) {
  return unwrap<RoomRef>(
    await supabase.rpc("create_room", {
      p_mode: mode,
      p_max_players: settings.maxPlayers,
      p_produce_seconds: settings.produceSeconds,
      p_vote_seconds: settings.voteSeconds,
      p_is_private: settings.isPrivate,
      p_name: settings.name,
      p_reveal_names: settings.revealNames,
      p_listen_seconds: settings.listenSeconds,
    }),
  );
}

export async function quickMatch(supabase: TypedSupabaseClient, mode: RoomMode) {
  return unwrap<QuickMatchResult>(await supabase.rpc("quick_match", { p_mode: mode }));
}

export async function joinRoom(supabase: TypedSupabaseClient, code: string) {
  return unwrap<RoomRef>(await supabase.rpc("join_room", { p_code: code }));
}

export async function leaveRoom(supabase: TypedSupabaseClient, roomId: string) {
  unwrap(await supabase.rpc("leave_room", { p_room_id: roomId }));
}

export async function setReady(supabase: TypedSupabaseClient, roomId: string, ready: boolean) {
  unwrap(await supabase.rpc("set_ready", { p_room_id: roomId, p_ready: ready }));
}

export async function startGame(supabase: TypedSupabaseClient, roomId: string, options: { force?: boolean } = {}) {
  unwrap(await supabase.rpc("start_game", { p_room_id: roomId, p_force: options.force ?? false }));
}

export type SubmitResult = { submission_id: string; replaced_path: string | null };

export async function submitTrack(supabase: TypedSupabaseClient, roomId: string, uploadId: string) {
  return unwrap<SubmitResult>(await supabase.rpc("submit_track", { p_room_id: roomId, p_upload_id: uploadId }));
}

export async function castVote(supabase: TypedSupabaseClient, roomId: string, submissionId: string, score: number) {
  unwrap(await supabase.rpc("cast_vote", { p_room_id: roomId, p_submission_id: submissionId, p_score: score }));
}

export async function sendChat(supabase: TypedSupabaseClient, roomId: string, body: string) {
  return unwrap<number>(await supabase.rpc("send_chat", { p_room_id: roomId, p_body: body }));
}

export async function advanceRoom(supabase: TypedSupabaseClient, roomId: string) {
  return unwrap<AdvanceResult>(await supabase.rpc("advance_room", { p_room_id: roomId }));
}

export async function getRoomSnapshot(supabase: TypedSupabaseClient, roomId: string) {
  return unwrap<RoomSnapshot>(await supabase.rpc("get_room_snapshot", { p_room_id: roomId }));
}

export async function updateRoomSettings(
  supabase: TypedSupabaseClient,
  roomId: string,
  changes: RoomSettings & { mode?: RoomMode },
) {
  unwrap(
    await supabase.rpc("update_room_settings", {
      p_room_id: roomId,
      p_name: changes.name,
      p_max_players: changes.maxPlayers,
      p_produce_seconds: changes.produceSeconds,
      p_vote_seconds: changes.voteSeconds,
      p_is_private: changes.isPrivate,
      p_mode: changes.mode,
      p_reveal_names: changes.revealNames,
      p_listen_seconds: changes.listenSeconds,
    }),
  );
}

export async function skipTrack(supabase: TypedSupabaseClient, roomId: string) {
  return unwrap<SkipResult>(await supabase.rpc("skip_track", { p_room_id: roomId }));
}

export async function kickPlayer(supabase: TypedSupabaseClient, roomId: string, userId: string) {
  unwrap(await supabase.rpc("kick_player", { p_room_id: roomId, p_user_id: userId }));
}

export async function voteKick(supabase: TypedSupabaseClient, roomId: string, targetId: string) {
  return unwrap<KickResult>(await supabase.rpc("vote_kick", { p_room_id: roomId, p_target: targetId }));
}

export async function touchRoom(supabase: TypedSupabaseClient, roomId: string) {
  unwrap(await supabase.rpc("touch_room", { p_room_id: roomId }));
}

export type UploadKind = "submission" | "avatar";
export type Reservation = { upload_id: string; path: string | null };

export async function reserveUpload(supabase: TypedSupabaseClient, roomId: string | null, kind: UploadKind) {
  return unwrap<Reservation>(await supabase.rpc("reserve_upload", { p_room_id: roomId, p_kind: kind }));
}

export async function getProfile(supabase: TypedSupabaseClient, username: string) {
  return unwrap<PublicProfile>(await supabase.rpc("get_profile", { p_username: username }));
}

export async function listPublicRooms(supabase: TypedSupabaseClient) {
  return unwrap<PublicRoom[]>(await supabase.rpc("list_public_rooms"));
}

export async function serverTime(supabase: TypedSupabaseClient) {
  return unwrap<string>(await supabase.rpc("server_time"));
}
