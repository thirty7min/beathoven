import { describe, expect, it } from "vitest";
import { LEAVE_GRACE_MS, createTabId, isSameOriginRequest, leaveBeaconBody, leaveNeedsConfirm, myLeavePending, parseLeaveBeacon, pendingLeaves } from "./leave";
import type { RoomPlayer, RoomStatus } from "./types";

describe("leaveNeedsConfirm", () => {
  it("asks only while a game is running", () => {
    const cases: Record<RoomStatus, boolean> = { lobby: false, producing: true, listening: true, reviewing: true, results: false, closed: false };
    for (const [status, expected] of Object.entries(cases)) expect(leaveNeedsConfirm(status as RoomStatus)).toBe(expected);
  });

  it("never asks a spectator", () => {
    for (const status of ["producing", "listening", "reviewing"] as const) expect(leaveNeedsConfirm(status, "spectator")).toBe(false);
  });
});

const player = (overrides: Partial<RoomPlayer>): RoomPlayer => ({
  user_id: "a",
  username: "a",
  avatar_url: null,
  joined_at: "2026-10-20T00:00:00Z",
  left_at: null,
  is_ready: false,
  ...overrides,
});

describe("pendingLeaves", () => {
  it("lists other active members with a leave mark, due 8s after it", () => {
    const players = [
      player({ user_id: "me", leave_pending_at: "2026-10-20T00:00:00Z" }),
      player({ user_id: "b", leave_pending_at: "2026-10-20T00:00:01Z" }),
      player({ user_id: "c", leave_pending_at: "2026-10-20T00:00:01Z", left_at: "2026-10-20T00:00:02Z" }),
      player({ user_id: "d", leave_pending_at: null }),
      player({ user_id: "e" }),
    ];
    expect(LEAVE_GRACE_MS).toBe(8000);
    expect(pendingLeaves(players, "me")).toEqual([
      { userId: "b", markedAt: "2026-10-20T00:00:01Z", dueAt: Date.parse("2026-10-20T00:00:01Z") + LEAVE_GRACE_MS },
    ]);
  });
});

describe("myLeavePending", () => {
  it("returns your own active mark", () => {
    expect(myLeavePending([player({ user_id: "me", leave_pending_at: "x" })], "me")).toBe("x");
    expect(myLeavePending([player({ user_id: "me", leave_pending_at: "x", left_at: "y" })], "me")).toBeNull();
    expect(myLeavePending([player({ user_id: "me" })], "me")).toBeNull();
  });
});

describe("leave beacon", () => {
  it("round-trips a tab id", () => {
    const tabId = createTabId();
    expect(tabId).toMatch(/^[0-9a-f]{24}$/);
    expect(parseLeaveBeacon(leaveBeaconBody(tabId))).toBe(tabId);
  });

  it("rejects anything else", () => {
    for (const text of ["", "null", "{}", '{"tabId":1}', '{"tabId":"not hex!"}', `{"tabId":"${"a".repeat(65)}"}`]) {
      expect(parseLeaveBeacon(text)).toBeNull();
    }
  });
});

describe("isSameOriginRequest", () => {
  const headers = (entries: Record<string, string>) => new Headers(entries);

  it("trusts the browser's fetch site", () => {
    expect(isSameOriginRequest(headers({ "sec-fetch-site": "same-origin" }))).toBe(true);
    for (const site of ["same-site", "cross-site", "none"]) {
      expect(isSameOriginRequest(headers({ "sec-fetch-site": site, origin: "https://beathoven.io", host: "beathoven.io" }))).toBe(false);
    }
  });

  it("falls back to matching the origin host to the host header", () => {
    expect(isSameOriginRequest(headers({ origin: "https://beathoven.io", host: "beathoven.io" }))).toBe(true);
    expect(isSameOriginRequest(headers({ origin: "http://localhost:3000", host: "localhost:3000" }))).toBe(true);
    expect(isSameOriginRequest(headers({ origin: "https://evil.example", host: "beathoven.io" }))).toBe(false);
    expect(isSameOriginRequest(headers({ origin: "null", host: "beathoven.io" }))).toBe(false);
    expect(isSameOriginRequest(headers({ host: "beathoven.io" }))).toBe(false);
  });
});
