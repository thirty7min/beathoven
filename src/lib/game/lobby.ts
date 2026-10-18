import type { RoomPlayer, RoomSnapshot } from "./types";

export const MIN_PLAYERS = 2;

export function activePlayers(players: RoomPlayer[]): RoomPlayer[] {
  return players.filter((p) => p.left_at === null);
}

export type StartCheck =
  | { kind: "ready" }
  | { kind: "force"; waitingFor: number }
  | { kind: "blocked"; reason: string };

export function startCheck(snapshot: Pick<RoomSnapshot, "players" | "me" | "room">, live: boolean): StartCheck {
  if (snapshot.room.status !== "lobby") return { kind: "blocked", reason: "A game is already running." };
  if (snapshot.room.host_id !== snapshot.me) return { kind: "blocked", reason: "Only the host can start." };
  if (!live) return { kind: "blocked", reason: "Reconnecting to the room…" };
  const active = activePlayers(snapshot.players);
  if (active.length < MIN_PLAYERS) return { kind: "blocked", reason: "Need at least 2 players to start." };
  const waitingFor = active.filter((p) => p.user_id !== snapshot.me && !p.is_ready).length;
  return waitingFor === 0 ? { kind: "ready" } : { kind: "force", waitingFor };
}

export function isReady(player: RoomPlayer, hostId: string | null): boolean {
  return player.is_ready || player.user_id === hostId;
}

export function readyCount(players: RoomPlayer[], hostId: string | null) {
  const active = activePlayers(players);
  return { ready: active.filter((p) => isReady(p, hostId)).length, total: active.length };
}

export function submittedUserIds(snapshot: RoomSnapshot): string[] {
  return snapshot.submitted_user_ids ?? snapshot.submissions.flatMap((s) => (s.user_id ? [s.user_id] : []));
}

export function playerPhaseStatus(snapshot: RoomSnapshot, userId: string): "ready" | "waiting" | "done" | null {
  const { room } = snapshot;
  switch (room.status) {
    case "lobby": {
      const player = snapshot.players.find((p) => p.user_id === userId);
      return player && isReady(player, room.host_id) ? "ready" : "waiting";
    }
    case "producing":
      return submittedUserIds(snapshot).includes(userId) ? "done" : "waiting";
    case "listening": {
      // Blind rooms hide who voted, or the one player who can't vote would be outed as the producer.
      const voters = snapshot.current_votes?.voted_user_ids;
      if (!room.reveal_names || !voters) return null;
      const track = snapshot.submissions.find((s) => s.id === snapshot.current_votes?.submission_id);
      if (!track || track.user_id === userId) return null;
      return voters.includes(userId) ? "done" : "waiting";
    }
    default:
      return null;
  }
}
