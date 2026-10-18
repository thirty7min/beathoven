import { resampleHeights } from "@/lib/game/waveform";

export const STORED_PEAKS = 120;

export function storedPeaks(heights: number[]): number[] | null {
  if (heights.length === 0) return null;
  return resampleHeights(heights, STORED_PEAKS).map((h) => Math.round(Math.min(1, Math.max(0, h)) * 255));
}

export function readStoredPeaks(peaks: number[] | null | undefined): number[] | null {
  return peaks && peaks.length > 0 ? peaks.map((p) => p / 255) : null;
}
