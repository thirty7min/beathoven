export const MIN_CLIP_MS = 10_000;
export const KEY_STEP_MS = 1_000;
export const KEY_STEP_LARGE_MS = 5_000;

export type ClipWindow = { startMs: number; endMs: number };
export type ClipLimits = { durationMs: number; minMs: number; maxMs: number };

export function clipLimits(durationMs: number, listenSeconds: number | null | undefined): ClipLimits {
  const duration = Math.max(0, Math.round(durationMs));
  const cap = listenSeconds && listenSeconds > 0 ? Math.min(duration, listenSeconds * 1000) : duration;
  return { durationMs: duration, minMs: Math.min(MIN_CLIP_MS, cap), maxMs: cap };
}

export function initialClip(limits: ClipLimits, saved?: Partial<ClipWindow> | null): ClipWindow {
  if (saved?.startMs != null && saved.endMs != null) return normalizeClip({ startMs: saved.startMs, endMs: saved.endMs }, limits);
  return { startMs: 0, endMs: limits.maxMs };
}

export function normalizeClip(clip: ClipWindow, limits: ClipLimits): ClipWindow {
  const length = Math.min(limits.maxMs, Math.max(limits.minMs, clip.endMs - clip.startMs));
  const startMs = Math.round(Math.min(Math.max(0, clip.startMs), limits.durationMs - length));
  return { startMs, endMs: startMs + Math.round(length) };
}

export function moveStart(clip: ClipWindow, toMs: number, limits: ClipLimits): ClipWindow {
  const lowest = Math.max(0, clip.endMs - limits.maxMs);
  const highest = clip.endMs - limits.minMs;
  return { startMs: Math.round(Math.min(highest, Math.max(lowest, toMs))), endMs: clip.endMs };
}

export function moveEnd(clip: ClipWindow, toMs: number, limits: ClipLimits): ClipWindow {
  const lowest = clip.startMs + limits.minMs;
  const highest = Math.min(limits.durationMs, clip.startMs + limits.maxMs);
  return { startMs: clip.startMs, endMs: Math.round(Math.min(highest, Math.max(lowest, toMs))) };
}

export function shiftClip(clip: ClipWindow, deltaMs: number, limits: ClipLimits): ClipWindow {
  const length = clip.endMs - clip.startMs;
  const startMs = Math.round(Math.min(limits.durationMs - length, Math.max(0, clip.startMs + deltaMs)));
  return { startMs, endMs: startMs + length };
}

export function keyStep(key: string, large: boolean): number | null {
  const step = large ? KEY_STEP_LARGE_MS : KEY_STEP_MS;
  if (key === "ArrowRight" || key === "ArrowUp") return step;
  if (key === "ArrowLeft" || key === "ArrowDown") return -step;
  return null;
}

export function msAtFraction(fraction: number, durationMs: number): number {
  return Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) * durationMs : 0;
}

export function sameClip(a: ClipWindow | null | undefined, b: ClipWindow | null | undefined): boolean {
  return !!a && !!b && a.startMs === b.startMs && a.endMs === b.endMs;
}

export type SubmissionStatus = "draft" | "submitted" | "edited" | "locked";

export function submissionStatus({ confirmed, dirty, closed }: { confirmed: boolean; dirty: boolean; closed: boolean }): SubmissionStatus {
  if (closed) return "locked";
  if (!confirmed) return "draft";
  return dirty ? "edited" : "submitted";
}

export const PREVIEW_REWIND_SLACK_MS = 250;

export function previewShouldStop(positionMs: number, clip: ClipWindow): boolean {
  return positionMs >= clip.endMs || positionMs < clip.startMs - PREVIEW_REWIND_SLACK_MS;
}

export const HANDLE_HIT_PX = 12;
export const CLICK_SLOP_PX = { mouse: 4, touch: 8 } as const;
export const CLICK_MAX_MS = 250;

export type TrimmerHit = "start" | "end" | "window" | "outside";

export function trimmerHit(x: number, width: number, clip: ClipWindow, durationMs: number, editable: boolean): TrimmerHit {
  if (width <= 0 || durationMs <= 0) return "outside";
  const startX = (clip.startMs / durationMs) * width;
  const endX = (clip.endMs / durationMs) * width;
  if (!editable) return "outside";
  const toStart = Math.abs(x - startX);
  const toEnd = Math.abs(x - endX);
  if (Math.min(toStart, toEnd) <= HANDLE_HIT_PX) return toStart <= toEnd ? "start" : "end";
  return x > startX && x < endX ? "window" : "outside";
}

export type Gesture = "pending" | "seek" | "move" | "resize" | "scrub" | "ignore";

export function classifyGesture({
  hit,
  distancePx,
  elapsedMs,
  pointerType,
  released,
}: {
  hit: TrimmerHit;
  distancePx: number;
  elapsedMs: number;
  pointerType: string;
  released: boolean;
}): Gesture {
  if (hit === "start" || hit === "end") return "resize";
  const slop = pointerType === "mouse" ? CLICK_SLOP_PX.mouse : CLICK_SLOP_PX.touch;
  if (distancePx > slop) return hit === "window" ? "move" : "scrub";
  if (!released) return "pending";
  return elapsedMs <= CLICK_MAX_MS ? "seek" : "ignore";
}

export type PlaybackMode = "selection" | "free";

export function playbackStopMs(mode: PlaybackMode, fromMs: number, clip: ClipWindow, durationMs: number): number {
  if (mode === "selection") return clip.endMs;
  return fromMs >= clip.startMs && fromMs < clip.endMs ? clip.endMs : durationMs;
}
