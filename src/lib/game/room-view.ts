import { activePlayers, readyCount, submittedUserIds } from "./lobby";
import { currentSubmission, phaseCountdown } from "./phase";
import type { RoomSnapshot } from "./types";
import { voteProgress } from "./voting";

export type HeroClock = { label: string; remainingMs: number | null; idleMs?: number };

/**
 * The big number in the room header. Producing shows the produce deadline,
 * never the upload grace that follows it.
 */
export function heroClock(snapshot: RoomSnapshot, serverNow: number | null): HeroClock {
  const { room } = snapshot;
  if (room.status === "lobby" || room.status === "closed" || serverNow === null) {
    return { label: "Produce time", remainingMs: null, idleMs: room.produce_seconds * 1000 };
  }
  const countdown = phaseCountdown(room, snapshot.submissions, serverNow);
  if (!countdown) return { label: "", remainingMs: null };
  switch (countdown.label) {
    case "produce":
      return { label: "Time left to produce", remainingMs: countdown.remainingMs };
    case "upload":
      return { label: "Time's up, last uploads landing", remainingMs: 0 };
    case "starting":
      return { label: "Next track starts in", remainingMs: countdown.remainingMs };
    case "track":
      return { label: "Track ends in", remainingMs: countdown.remainingMs };
    case "review":
      return { label: "Review ends in", remainingMs: countdown.remainingMs };
    case "results":
      return { label: "Back to lobby in", remainingMs: countdown.remainingMs };
  }
}

export type PhaseStat = { label: string; done: number; total: number } | null;

export function phaseStat(snapshot: RoomSnapshot): PhaseStat {
  const players = activePlayers(snapshot.players);
  switch (snapshot.room.status) {
    case "lobby": {
      const { ready, total } = readyCount(snapshot.players);
      return { label: "Ready", done: ready, total };
    }
    case "producing": {
      const submitted = new Set(submittedUserIds(snapshot));
      return { label: "Submitted", done: players.filter((p) => submitted.has(p.user_id)).length, total: players.length };
    }
    case "listening": {
      const { voted, eligible } = snapshot.current_votes
        ? { voted: snapshot.current_votes.count, eligible: snapshot.current_votes.eligible }
        : voteProgress(
            currentSubmission(snapshot.room, snapshot.submissions),
            snapshot.votes_cast,
            players.map((p) => p.user_id),
          );
      return { label: "Rated", done: voted, total: eligible };
    }
    case "reviewing":
      return { label: "Done", done: snapshot.review?.done_user_ids.length ?? 0, total: snapshot.review?.total ?? players.length };
    case "results":
      return { label: "Tracks", done: snapshot.results.length, total: snapshot.results.length };
    default:
      return null;
  }
}
