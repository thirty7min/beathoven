import type { SkipState } from "./types";

export function skipVotesNeeded(freshHumans: number): number {
  return Math.floor(Math.max(0, freshHumans) / 2) + 1;
}

export function canVoteSkip(skip: SkipState | null | undefined, submissionId: string | null | undefined): boolean {
  return !!skip && !!submissionId && skip.submission_id === submissionId && skip.you_voted !== true && skip.votes < skip.needed;
}

export function skipLabel(skip: Pick<SkipState, "votes" | "needed">): string {
  return `Skip ${Math.min(skip.votes, skip.needed)}/${skip.needed}`;
}
