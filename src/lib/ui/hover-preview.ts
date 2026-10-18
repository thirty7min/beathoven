export const HOVER_INTENT_MS = 200;
export const PREVIEW_FADE_IN_MS = 120;
export const PREVIEW_FADE_OUT_MS = 100;

export type PreviewTransition = "none" | "stop" | "start" | "handoff";

export function previewTransition(audible: boolean, nextId: string | null): PreviewTransition {
  if (nextId === null) return audible ? "stop" : "none";
  return audible ? "handoff" : "start";
}

export function isStaleAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export type PreviewState = { activeId: string | null; pendingId: string | null; blockedId: string | null };

export type PreviewEvent =
  | { type: "enter"; id: string }
  | { type: "intent"; id: string }
  | { type: "leave"; id: string }
  | { type: "tap"; id: string }
  | { type: "ended"; id: string }
  | { type: "blocked"; id: string };

export const initialPreviewState: PreviewState = { activeId: null, pendingId: null, blockedId: null };

export function previewReducer(state: PreviewState, event: PreviewEvent): PreviewState {
  switch (event.type) {
    case "enter":
      return state.activeId === event.id ? state : { ...state, pendingId: event.id };
    case "intent":
      return state.pendingId === event.id ? { ...state, activeId: event.id, pendingId: null } : state;
    case "leave":
      return {
        ...state,
        pendingId: state.pendingId === event.id ? null : state.pendingId,
        activeId: state.activeId === event.id ? null : state.activeId,
      };
    case "tap":
      return { activeId: state.activeId === event.id ? null : event.id, pendingId: null, blockedId: null };
    case "ended":
      return state.activeId === event.id ? { ...state, activeId: null } : state;
    case "blocked":
      return state.activeId === event.id ? { ...state, activeId: null, blockedId: event.id } : state;
  }
}

export function fadeVolume(from: number, to: number, elapsedMs: number, durationMs: number): number {
  if (durationMs <= 0 || elapsedMs >= durationMs) return to;
  const t = Math.max(0, elapsedMs) / durationMs;
  return from + (to - from) * t;
}

export function previewProgress(positionMs: number, durationMs: number, limitMs: number | null): { progress: number; done: boolean } {
  const span = limitMs !== null && limitMs > 0 ? (durationMs > 0 ? Math.min(limitMs, durationMs) : limitMs) : durationMs;
  if (!(span > 0)) return { progress: 0, done: false };
  return { progress: Math.min(1, Math.max(0, positionMs / span)), done: limitMs !== null && positionMs >= span };
}
