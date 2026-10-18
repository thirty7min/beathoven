import type { MyVote, Submission, VoteCast } from "./types";

export const DEFAULT_SCORE = 3;

export type VoteState =
  | { kind: "unavailable" }
  | { kind: "own_track" }
  | { kind: "waiting"; score: number; saved: boolean }
  | { kind: "open"; score: number; saved: boolean }
  | { kind: "closed"; score: number; saved: boolean };

type VoteInput = {
  submission: Submission | null;
  isMine: boolean;
  myVotes: MyVote[];
  trackStarted: boolean;
  trackEnded: boolean;
};

export function voteState({ submission, isMine, myVotes, trackStarted, trackEnded }: VoteInput): VoteState {
  if (!submission) return { kind: "unavailable" };
  if (isMine) return { kind: "own_track" };
  const mine = myVotes.find((v) => v.submission_id === submission.id);
  const score = mine?.score ?? DEFAULT_SCORE;
  const saved = mine !== undefined;
  if (trackEnded) return { kind: "closed", score, saved };
  if (!trackStarted) return { kind: "waiting", score, saved };
  return { kind: "open", score, saved };
}

export function voteProgress(submission: Submission | null, votesCast: VoteCast[], activePlayerIds: string[]) {
  if (!submission) return { voted: 0, eligible: 0 };
  const eligible = activePlayerIds.filter((id) => id !== submission.user_id);
  const voters = new Set(votesCast.filter((v) => v.submission_id === submission.id).map((v) => v.voter_id));
  return { voted: eligible.filter((id) => voters.has(id)).length, eligible: eligible.length };
}

export const SCORE_LABELS: Record<number, string> = {
  1: "Weak",
  2: "Meh",
  3: "Solid",
  4: "Great",
  5: "Fire",
};

export async function sendVoteQuietly(send: () => Promise<unknown>, isTransient: (error: unknown) => boolean): Promise<boolean> {
  try {
    await send();
    return true;
  } catch (error) {
    if (!isTransient(error)) return false;
  }
  try {
    await send();
    return true;
  } catch {
    return false;
  }
}
