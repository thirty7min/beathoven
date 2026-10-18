import { describe, expect, it } from "vitest";
import { etaLabel, phaseStatusLine, roomTitle, splitRooms } from "./room-list";
import type { PublicRoom } from "./types";

const T0 = Date.parse("2026-01-01T00:00:00Z");

const room = (over: Partial<PublicRoom> = {}): PublicRoom => ({
  id: "r",
  code: "ABCDEF",
  mode: "classic",
  status: "lobby",
  max_players: 8,
  player_count: 1,
  host_username: "wilba",
  name: "",
  round: 0,
  phase_ends_at: null,
  estimated_end_at: null,
  joinable: true,
  created_at: "",
  ...over,
});

describe("room list", () => {
  it("prefers the room name, then the host", () => {
    expect(roomTitle(room({ name: " Trap beats " }))).toBe("Trap beats");
    expect(roomTitle(room())).toBe("wilba's room");
    expect(roomTitle(room({ host_username: null }))).toBe("Open room");
    expect(roomTitle(room({ name: "", host_display_name: "Wilba ✨" }))).toBe("Wilba ✨'s room");
  });

  it("splits open lobbies from rooms in progress", () => {
    const { open, inProgress } = splitRooms([
      room(),
      room({ status: "producing" }),
      room({ status: "results" }),
      room({ status: "closed" }),
    ]);
    expect(open).toHaveLength(1);
    expect(inProgress).toHaveLength(2);
  });

  it("labels the phase with time left, excluding the upload grace", () => {
    const ends = new Date(T0 + 9 * 60_000 + 15_000).toISOString();
    expect(phaseStatusLine({ mode: "classic", status: "producing", phase_ends_at: ends }, T0)).toBe("Producing · 9:00");
    const premadeEnds = new Date(T0 + 180_000 + 15_000 + 2_000).toISOString();
    expect(phaseStatusLine({ mode: "premade", status: "producing", phase_ends_at: premadeEnds }, T0)).toBe("Uploading · 3:00");
    expect(phaseStatusLine({ mode: "classic", status: "listening", phase_ends_at: new Date(T0 + 5000).toISOString() }, T0)).toBe("Listening · 0:05");
    expect(phaseStatusLine({ mode: "classic", status: "results", phase_ends_at: null }, T0)).toBe("Results");
    expect(phaseStatusLine({ mode: "classic", status: "lobby", phase_ends_at: null }, T0)).toBeNull();
  });

  it("rounds the ETA up to minutes", () => {
    expect(etaLabel({ estimated_end_at: new Date(T0 + 830_000).toISOString() }, T0)).toBe("~14m to finish");
    expect(etaLabel({ estimated_end_at: new Date(T0 - 5000).toISOString() }, T0)).toBe("~1m to finish");
    expect(etaLabel({ estimated_end_at: null }, T0)).toBeNull();
  });
});
