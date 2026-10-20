import { describe, expect, it } from "vitest";
import { activeSpectators, canReclaimSeat, isSpectating, myRole, roomAction, spectatorLabel, wasPromoted } from "./spectate";
import type { RoomPlayer, RoomSnapshot, RoomStatus } from "./types";

const member = (user_id: string, over: Partial<RoomPlayer> = {}): RoomPlayer => ({
  user_id,
  username: user_id,
  avatar_url: null,
  joined_at: "",
  left_at: null,
  is_ready: false,
  ...over,
});

const snap = (players: RoomPlayer[], status: RoomStatus = "listening") =>
  ({ me: "me", players, room: { status } }) as unknown as RoomSnapshot;

describe("spectators", () => {
  it("lists only active spectators", () => {
    const players = [member("a"), member("fan", { role: "spectator" }), member("gone", { role: "spectator", left_at: "x" })];
    expect(activeSpectators(players).map((p) => p.user_id)).toEqual(["fan"]);
  });

  it("knows when you're watching", () => {
    expect(isSpectating(snap([member("a"), member("me", { role: "spectator" })]))).toBe(true);
    expect(isSpectating(snap([member("me")]))).toBe(false);
    expect(isSpectating(snap([member("me", { role: "spectator", left_at: "x" })]))).toBe(false);
  });

  it("reads your active role", () => {
    expect(myRole(snap([member("me", { role: "spectator" })]))).toBe("spectator");
    expect(myRole(snap([member("me")]))).toBe("player");
    expect(myRole(snap([member("me", { left_at: "x" })]))).toBeNull();
  });

  it("spots a promotion back in the lobby, not a removal", () => {
    expect(wasPromoted(true, snap([member("me", { role: "player" })], "lobby"))).toBe(true);
    expect(wasPromoted(true, snap([member("me", { role: "spectator" })], "lobby"))).toBe(false);
    expect(wasPromoted(true, snap([], "lobby"))).toBe(false);
    expect(wasPromoted(false, snap([member("me")], "lobby"))).toBe(false);
  });
});

describe("roomAction", () => {
  it("joins open seats and watches everything else", () => {
    expect(roomAction({ status: "lobby", joinable: true })).toBe("join");
    expect(roomAction({ status: "lobby", joinable: false })).toBe("watch");
    expect(roomAction({ status: "listening", joinable: false })).toBe("watch");
    expect(roomAction({ status: "closed", joinable: false })).toBeNull();
  });

  it("labels the audience", () => {
    expect(spectatorLabel(3)).toBe("3 watching");
  });
});

describe("canReclaimSeat", () => {
  const room = (status: RoomStatus) => ({ status, phase_started_at: "2026-10-20T00:00:00Z" });
  const at = (players: RoomPlayer[], status: RoomStatus = "producing") =>
    ({ me: "me", players, room: room(status) }) as unknown as RoomSnapshot;

  it("is true for a player who left during the current upload phase", () => {
    expect(canReclaimSeat(at([member("me", { left_at: "2026-10-20T00:01:00Z" })]))).toBe(true);
  });

  it("is false after the upload phase, for spectators, for earlier leavers and for active members", () => {
    expect(canReclaimSeat(at([member("me", { left_at: "2026-10-20T00:01:00Z" })], "listening"))).toBe(false);
    expect(canReclaimSeat(at([member("me", { role: "spectator", left_at: "2026-10-20T00:01:00Z" })]))).toBe(false);
    expect(canReclaimSeat(at([member("me", { left_at: "2026-10-19T23:59:00Z" })]))).toBe(false);
    expect(canReclaimSeat(at([member("me")]))).toBe(false);
  });
});
