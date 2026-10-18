export function totalPoints(avgScore: number | string | null, voteCount: number): number | null {
  if (avgScore === null || voteCount <= 0) return null;
  const avg = typeof avgScore === "string" ? Number(avgScore) : avgScore;
  return Number.isFinite(avg) ? Math.round(avg * voteCount) : null;
}

export function pointsLabel(points: number | null): string {
  if (points === null) return "No points";
  return `${points} ${points === 1 ? "point" : "points"}`;
}
