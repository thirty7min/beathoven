import { AUTOSTART_SECONDS } from "@/lib/game/phase";

export type AutostartView = { seconds: number; fraction: number };

export function autostartView(remainingMs: number | null): AutostartView | null {
  if (remainingMs === null) return null;
  const total = AUTOSTART_SECONDS * 1000;
  const clamped = Math.min(total, Math.max(0, remainingMs));
  return { seconds: Math.max(1, Math.ceil(clamped / 1000)), fraction: clamped / total };
}
