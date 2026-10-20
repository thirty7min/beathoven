import type { RoomPlayer, RoomRole, RoomStatus } from "./types";

export const LEAVE_GRACE_MS = 8000;
export const LEAVE_BEACON_PATH = "/api/rooms/leave";

const TAB_ID = /^[0-9a-f]{8,64}$/;

export type PendingLeave = { userId: string; markedAt: string; dueAt: number };

export function leaveNeedsConfirm(status: RoomStatus, role: RoomRole = "player"): boolean {
  if (role === "spectator") return false;
  return status === "producing" || status === "listening" || status === "reviewing";
}

export function pendingLeaves(players: RoomPlayer[], me: string): PendingLeave[] {
  return players.flatMap((p) =>
    p.left_at === null && p.leave_pending_at && p.user_id !== me
      ? [{ userId: p.user_id, markedAt: p.leave_pending_at, dueAt: Date.parse(p.leave_pending_at) + LEAVE_GRACE_MS }]
      : [],
  );
}

export function myLeavePending(players: RoomPlayer[], me: string): string | null {
  return players.find((p) => p.user_id === me && p.left_at === null)?.leave_pending_at ?? null;
}

export function createTabId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function leaveBeaconBody(tabId: string): string {
  return JSON.stringify({ tabId });
}

export function parseLeaveBeacon(text: string): string | null {
  try {
    const body = JSON.parse(text) as { tabId?: unknown } | null;
    return typeof body?.tabId === "string" && TAB_ID.test(body.tabId) ? body.tabId : null;
  } catch {
    return null;
  }
}

export function isSameOriginRequest(headers: Headers): boolean {
  const site = headers.get("sec-fetch-site");
  if (site !== null) return site === "same-origin";
  const origin = headers.get("origin");
  const host = headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function beaconSent(body: string): boolean {
  try {
    return navigator.sendBeacon?.(LEAVE_BEACON_PATH, body) ?? false;
  } catch {
    return false;
  }
}

export function sendLeaveBeacon(tabId: string) {
  const body = leaveBeaconBody(tabId);
  if (beaconSent(body)) return;
  void fetch(LEAVE_BEACON_PATH, { method: "POST", body, keepalive: true }).catch(() => undefined);
}
