import type { ChatMessage, KickVote, RoomPlayer, RoomSnapshot } from "./types";

export { kickPlayer, voteKick } from "./rpc";

export function kickVoteFor(snapshot: RoomSnapshot, userId: string): KickVote | null {
  return snapshot.kick_votes?.find((v) => v.target_user_id === userId) ?? null;
}

export function votedToKick(snapshot: RoomSnapshot, userId: string): boolean {
  return (snapshot.my_kick_votes ?? []).includes(userId);
}

export const MIN_HUMANS_TO_VOTE_KICK = 3;

export type KickAction = "kick" | "vote" | "voted" | null;

export function kickActionFor(snapshot: RoomSnapshot, target: RoomPlayer): KickAction {
  if (target.user_id === snapshot.me || target.left_at !== null) return null;
  if (snapshot.room.host_id === snapshot.me) return "kick";
  if (target.is_bot) return null;
  const humans = snapshot.players.filter((p) => p.left_at === null && !p.is_bot).length;
  if (humans < MIN_HUMANS_TO_VOTE_KICK) return null;
  return votedToKick(snapshot, target.user_id) ? "voted" : "vote";
}

export function isSystemMessage(message: ChatMessage): boolean {
  return message.kind === "system";
}

export function wasRemoved(players: RoomPlayer[], me: string): boolean {
  return !players.some((p) => p.user_id === me && p.left_at === null);
}

const REMOVED_ERRORS = ["banned_from_room", "not_member"];

export function isRemovedError(message: string | null | undefined): boolean {
  return message !== null && message !== undefined && REMOVED_ERRORS.some((code) => message.includes(code));
}
