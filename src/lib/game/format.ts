/** Countdown clock that rounds up, so "0:00" only shows once time is really up. */
export function formatClock(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = (total % 60).toString().padStart(2, "0");
  return hours ? `${hours}:${minutes.toString().padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

export function formatScore(avg: number | string | null): string {
  if (avg === null) return "–";
  const value = typeof avg === "string" ? Number(avg) : avg;
  return Number.isFinite(value) ? value.toFixed(2).replace(/\.?0+$/, "") || "0" : "–";
}
