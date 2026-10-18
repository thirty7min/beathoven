export type ScoreInput = { submissionId: string; userId: string };
export type VoteInput = { submissionId: string; score: number };

export type ScoredSubmission = {
  submissionId: string;
  userId: string;
  voteCount: number;
  total: number;
  average: number | null;
  rank: number;
  isWinner: boolean;
};

export type ScoreOutcome =
  | { kind: "none" }
  | { kind: "winner"; userId: string }
  | { kind: "tie"; userIds: string[] };

/** Compares averages exactly via cross-multiplication; null (no votes) sorts last. */
function compareAverage(a: ScoredSubmission, b: ScoredSubmission): number {
  if (a.voteCount === 0 || b.voteCount === 0) return Number(a.voteCount === 0) - Number(b.voteCount === 0);
  return b.total * a.voteCount - a.total * b.voteCount;
}

/** Mirrors `_enter_results` in SQL: standard competition ranking, ties share a rank. */
export function scoreRound(submissions: ScoreInput[], votes: VoteInput[]): ScoredSubmission[] {
  const scored = submissions.map<ScoredSubmission>((s) => {
    const own = votes.filter((v) => v.submissionId === s.submissionId);
    const total = own.reduce((sum, v) => sum + v.score, 0);
    return {
      submissionId: s.submissionId,
      userId: s.userId,
      voteCount: own.length,
      total,
      average: own.length ? total / own.length : null,
      rank: 0,
      isWinner: false,
    };
  });

  const sorted = [...scored].sort((a, b) => compareAverage(a, b) || a.userId.localeCompare(b.userId));
  sorted.forEach((s, i) => {
    s.rank = i > 0 && compareAverage(sorted[i - 1], s) === 0 ? sorted[i - 1].rank : i + 1;
  });
  const top = sorted[0];
  if (top && top.voteCount > 0) {
    for (const s of sorted) s.isWinner = compareAverage(top, s) === 0;
  }
  return sorted;
}

export function outcome(results: { userId: string; isWinner: boolean }[]): ScoreOutcome {
  const winners = results.filter((r) => r.isWinner).map((r) => r.userId);
  if (winners.length === 0) return { kind: "none" };
  if (winners.length === 1) return { kind: "winner", userId: winners[0] };
  return { kind: "tie", userIds: winners };
}
