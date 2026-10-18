import type { RoomPlayer, RoomSnapshot, Submission } from "./types";

export function revealedProducer(snapshot: Pick<RoomSnapshot, "room" | "players">, submission: Submission | null): RoomPlayer | null {
  if (!snapshot.room.reveal_names || !submission?.user_id) return null;
  return snapshot.players.find((p) => p.user_id === submission.user_id) ?? null;
}

export function isOwnSubmission(snapshot: Pick<RoomSnapshot, "my_submission">, submission: Submission | null): boolean {
  return submission !== null && snapshot.my_submission?.id === submission.id;
}
