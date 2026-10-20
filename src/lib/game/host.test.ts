import { describe, expect, it } from "vitest";
import { canMakeHost } from "./host";
import type { RoomPlayer, RoomSnapshot, RoomStatus } from "./types";

const player = (overrides: Partial<RoomPlayer> = {}): RoomPlayer => ({
  user_id: "kay",
  username: "kay",
  avatar_url: null,
  joined_at: "2026-10-20T00:00:00Z",
  left_at: null,
  is_ready: false,
  role: "player",
  ...overrides,
});

const snapshot = (status: RoomStatus = "lobby", hostId = "me") =>
  ({ me: "me", room: { status, host_id: hostId } }) as Pick<RoomSnapshot, "room" | "me">;

describe("canMakeHost", () => {
  it("lets the host promote another human player in the lobby", () => {
    expect(canMakeHost(snapshot(), player())).toBe(true);
  });

  it("is host only and lobby only", () => {
    expect(canMakeHost(snapshot("lobby", "kay"), player({ user_id: "zed" }))).toBe(false);
    for (const status of ["producing", "listening", "reviewing", "results", "closed"] as const) {
      expect(canMakeHost(snapshot(status), player())).toBe(false);
    }
  });

  it("never targets yourself, bots, spectators or people who left", () => {
    expect(canMakeHost(snapshot(), player({ user_id: "me" }))).toBe(false);
    expect(canMakeHost(snapshot(), player({ is_bot: true }))).toBe(false);
    expect(canMakeHost(snapshot(), player({ role: "spectator" }))).toBe(false);
    expect(canMakeHost(snapshot(), player({ left_at: "2026-10-20T00:01:00Z" }))).toBe(false);
  });
});
