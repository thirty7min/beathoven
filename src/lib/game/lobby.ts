import type { RoomPlayer, RoomSnapshot } from "./types";

export const MIN_PLAYERS = 2;

export function activePlayers(players: RoomPlayer[]): RoomPlayer[] {
  return players.filter((p) => p.left_at === null);
}

export type StartCheck =
  | { kind: "ready" }
  | { kind: "force"; ready: number; total: number }
  | { kind: "blocked"; reason: string };

export function startCheck(snapshot: Pick<RoomSnapshot, "players" | "me" | "room">, live: boolean): StartCheck {
  if (snapshot.room.status !== "lobby") return { kind: "blocked", reason: "A game is already running." };
  if (snapshot.room.host_id !== snapshot.me) return { kind: "blocked", reason: "Only the host can start." };
  if (!live) return { kind: "blocked", reason: "Reconnecting to the room…" };
  const { ready, total } = readyCount(snapshot.players);
  if (total < MIN_PLAYERS) return { kind: "blocked", reason: "Need at least 2 players to start." };
  return ready === total ? { kind: "ready" } : { kind: "force", ready, total };
}

export function readyCount(players: RoomPlayer[]) {
  const active = activePlayers(players);
  return { ready: active.filter((p) => p.is_ready).length, total: active.length };
}

export function submittedUserIds(snapshot: RoomSnapshot): string[] {
  return snapshot.submitted_user_ids ?? snapshot.submissions.flatMap((s) => (s.user_id ? [s.user_id] : []));
}

export function hasSubmitted(snapshot: RoomSnapshot, userId: string): boolean {
  const { status } = snapshot.room;
  if (status === "lobby" || status === "closed") return false;
  if (userId === snapshot.me && snapshot.my_submission) return snapshot.my_submission.confirmed;
  return submittedUserIds(snapshot).includes(userId);
}

export function memberBadge(snapshot: RoomSnapshot, userId: string, playingId: string | null): "playing" | "ready" | null {
  if (userId === playingId) return "playing";
  if (snapshot.room.status !== "lobby") return null;
  return snapshot.players.some((p) => p.user_id === userId && p.is_ready) ? "ready" : null;
}
