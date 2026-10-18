import type { PublicRoom, RoomPlayer, RoomRole, RoomSnapshot } from "./types";

export function isSpectator(player: Pick<RoomPlayer, "role">): boolean {
  return player.role === "spectator";
}

export function activeSpectators(players: RoomPlayer[]): RoomPlayer[] {
  return players.filter((p) => p.left_at === null && isSpectator(p));
}

export function isSpectating(snapshot: Pick<RoomSnapshot, "players" | "me">): boolean {
  return snapshot.players.some((p) => p.user_id === snapshot.me && p.left_at === null && isSpectator(p));
}

export function myRole(snapshot: Pick<RoomSnapshot, "players" | "me">): RoomRole | null {
  const me = snapshot.players.find((p) => p.user_id === snapshot.me && p.left_at === null);
  return me ? (me.role ?? "player") : null;
}

export function wasPromoted(wasSpectating: boolean, snapshot: Pick<RoomSnapshot, "players" | "me" | "room">): boolean {
  return (
    wasSpectating &&
    snapshot.room.status === "lobby" &&
    snapshot.players.some((p) => p.user_id === snapshot.me && p.left_at === null && !isSpectator(p))
  );
}

export function roomAction(room: Pick<PublicRoom, "joinable" | "status">): "join" | "watch" | null {
  if (room.status === "closed") return null;
  return room.joinable ? "join" : "watch";
}

export function spectatorLabel(count: number): string {
  return `${count} watching`;
}
