export const MIN_SCORE = 1;
export const MAX_SCORE = 5;

const SPAN = MAX_SCORE - MIN_SCORE;

export function clampScore(score: number): number {
  return Math.min(MAX_SCORE, Math.max(MIN_SCORE, Math.round(score)));
}

export function scoreAngle(score: number): number {
  return 180 - ((clampScore(score) - MIN_SCORE) / SPAN) * 180;
}

export function scoreFromPoint(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return MIN_SCORE;
  let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (angle < 0) angle = dx < 0 ? 180 : 0;
  return clampScore(MIN_SCORE + ((180 - angle) / 180) * SPAN);
}

export function stepScore(score: number | null, delta: number): number {
  return clampScore((score ?? (delta > 0 ? MIN_SCORE - 1 : MAX_SCORE + 1)) + delta);
}

export function scoreFromKey(key: string, current: number | null): number | null {
  const digit = Number(key);
  if (Number.isInteger(digit) && digit >= MIN_SCORE && digit <= MAX_SCORE) return digit;
  if (key === "ArrowRight" || key === "ArrowUp") return stepScore(current, 1);
  if (key === "ArrowLeft" || key === "ArrowDown") return stepScore(current, -1);
  return null;
}

export const DRAG_SEND_INTERVAL_MS = 300;

export function shouldSend({
  value,
  lastSent,
  dragging,
  msSinceLastSend,
}: {
  value: number;
  lastSent: number | null;
  dragging: boolean;
  msSinceLastSend: number | null;
}): boolean {
  if (value === lastSent) return false;
  if (!dragging) return true;
  return msSinceLastSend === null || msSinceLastSend >= DRAG_SEND_INTERVAL_MS;
}
