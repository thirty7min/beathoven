import { describe, expect, it } from "vitest";
import { leaveNeedsConfirm } from "./leave";
import type { RoomStatus } from "./types";

describe("leaveNeedsConfirm", () => {
  it("asks only while a game is running", () => {
    const cases: Record<RoomStatus, boolean> = { lobby: false, producing: true, listening: true, reviewing: true, results: false, closed: false };
    for (const [status, expected] of Object.entries(cases)) expect(leaveNeedsConfirm(status as RoomStatus)).toBe(expected);
  });

  it("never asks a spectator", () => {
    for (const status of ["producing", "listening", "reviewing"] as const) expect(leaveNeedsConfirm(status, "spectator")).toBe(false);
  });
});
