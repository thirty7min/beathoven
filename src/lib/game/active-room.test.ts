import { describe, expect, it } from "vitest";
import { activeRoomPill, leavesRoomPage, shouldHeartbeat, showsReturnPill } from "./active-room";
import type { ActiveRoom } from "./types";

const room = (overrides: Partial<ActiveRoom> = {}): ActiveRoom => ({
  id: "r1",
  code: "ABC123",
  name: "Late night",
  mode: "creative",
  genre: "all",
  status: "lobby",
  max_players: 8,
  player_count: 3,
  host_username: "kay",
  host_display_name: "Kay",
  ...overrides,
});

describe("activeRoomPill", () => {
  it("shows the head count in the lobby", () => {
    expect(activeRoomPill(room())).toEqual({ title: "Late night", status: "Lobby · 3/8", genre: null });
  });

  it("shows the phase mid-game, with upload wording for premade", () => {
    expect(activeRoomPill(room({ status: "listening" })).status).toBe("Listening");
    expect(activeRoomPill(room({ status: "producing" })).status).toBe("Producing");
    expect(activeRoomPill(room({ status: "producing", mode: "premade" })).status).toBe("Uploading");
  });

  it("marks a room you're watching", () => {
    expect(activeRoomPill(room({ status: "listening", role: "spectator" })).status).toBe("Spectating · Listening");
    expect(activeRoomPill(room({ role: "spectator" })).status).toBe("Spectating · Lobby · 3/8");
    expect(activeRoomPill(room({ role: "player" })).status).toBe("Lobby · 3/8");
  });

  it("names the genre only when one is set", () => {
    expect(activeRoomPill(room({ genre: "dnb" })).genre).toBe("Drum & Bass");
    expect(activeRoomPill(room({ genre: undefined })).genre).toBeNull();
  });

  it("falls back to the host's room when unnamed", () => {
    expect(activeRoomPill(room({ name: "" })).title).toBe("Kay's room");
  });
});

describe("showsReturnPill", () => {
  it("shows on every page except a room", () => {
    for (const path of ["/", "/play", "/lobbies", "/leaderboard", "/u/kay"]) expect(showsReturnPill(room(), path)).toBe(true);
    expect(showsReturnPill(room(), "/room/ABC123")).toBe(false);
    expect(showsReturnPill(room(), "/room/XYZ789")).toBe(false);
  });

  it("hides without an open room", () => {
    expect(showsReturnPill(null, "/")).toBe(false);
    expect(showsReturnPill(room({ status: "closed" }), "/")).toBe(false);
  });

  it("waits for the pathname", () => {
    expect(showsReturnPill(room(), null)).toBe(false);
  });
});

describe("leavesRoomPage", () => {
  it("is true only when navigating off a room page", () => {
    expect(leavesRoomPage("/room/ABC123", "/")).toBe(true);
    expect(leavesRoomPage("/room/ABC123", "/room/XYZ789")).toBe(false);
    expect(leavesRoomPage("/", "/room/ABC123")).toBe(false);
    expect(leavesRoomPage("/play", "/lobbies")).toBe(false);
    expect(leavesRoomPage(null, "/")).toBe(false);
  });
});

describe("shouldHeartbeat", () => {
  it("beats while in a room on any page", () => {
    expect(shouldHeartbeat(room(), "/leaderboard")).toBe(true);
  });

  it("beats on a room page before the membership is known", () => {
    expect(shouldHeartbeat(null, "/room/ABC123")).toBe(true);
  });

  it("stays quiet outside a room", () => {
    expect(shouldHeartbeat(null, "/")).toBe(false);
    expect(shouldHeartbeat(null, null)).toBe(false);
  });
});
