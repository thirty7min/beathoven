import { describe, expect, it } from "vitest";
import { isRemovedError, isSystemMessage, kickActionFor, kickVoteFor, removalDestination, removalMessage, votedToKick, wasRemoved } from "./kick";
import type { ChatMessage, RoomPlayer, RoomSnapshot } from "./types";

const snapshot = {
  kick_votes: [{ target_user_id: "b", votes: 2, needed: 3, expires_at: "2026-01-01T00:01:00Z" }],
  my_kick_votes: ["b"],
} as unknown as RoomSnapshot;

describe("kick helpers", () => {
  it("finds the active vote and whether you joined it", () => {
    expect(kickVoteFor(snapshot, "b")).toMatchObject({ votes: 2, needed: 3 });
    expect(kickVoteFor(snapshot, "c")).toBeNull();
    expect(votedToKick(snapshot, "b")).toBe(true);
    expect(votedToKick({} as RoomSnapshot, "b")).toBe(false);
  });

  it("spots system chat lines", () => {
    expect(isSystemMessage({ kind: "system" } as unknown as ChatMessage)).toBe(true);
    expect(isSystemMessage({} as ChatMessage)).toBe(false);
  });

  it("notices when your membership is gone", () => {
    const players = [{ user_id: "me", left_at: null }, { user_id: "x", left_at: null }] as RoomPlayer[];
    expect(wasRemoved(players, "me")).toBe(false);
    expect(wasRemoved([{ user_id: "me", left_at: "2026-01-01" }] as RoomPlayer[], "me")).toBe(true);
    expect(wasRemoved(players.slice(1), "me")).toBe(true);
    expect(wasRemoved([{ user_id: "me", left_at: null, role: "spectator" }] as RoomPlayer[], "me")).toBe(false);
  });

  it("tells a kick apart from an idle removal", () => {
    expect(removalMessage(true, "spectator")).toBe("You were removed from the room");
    expect(removalMessage(false, "spectator")).toBe("You stopped watching after being inactive");
    expect(removalMessage(false, "player")).toBe("You were removed from the room for inactivity");
    expect(removalMessage(false, null)).toBe("You were removed from the room for inactivity");
  });

  it("sends kicked players to Play and inactive ones home", () => {
    expect(removalDestination(true)).toBe("/play");
    expect(removalDestination(false)).toBe("/");
  });

  it("recognizes removal errors", () => {
    expect(isRemovedError("banned_from_room")).toBe(true);
    expect(isRemovedError("not_member")).toBe(true);
    expect(isRemovedError("network down")).toBe(false);
    expect(isRemovedError(null)).toBe(false);
  });

  describe("kickActionFor", () => {
    const player = (user_id: string, extra: Partial<RoomPlayer> = {}) => ({ user_id, left_at: null, is_bot: false, ...extra }) as RoomPlayer;
    const room = (me: string, players: RoomPlayer[], my_kick_votes: string[] = []) =>
      ({ me, room: { host_id: "host" }, players, my_kick_votes }) as unknown as RoomSnapshot;
    const bot = player("bot", { is_bot: true });

    it("lets the host kick anyone else, bots included", () => {
      const snap = room("host", [player("host"), player("a"), bot]);
      expect(kickActionFor(snap, player("a"))).toBe("kick");
      expect(kickActionFor(snap, bot)).toBe("kick");
      expect(kickActionFor(snap, player("host"))).toBeNull();
    });

    it("offers a vote only with three or more humans", () => {
      expect(kickActionFor(room("a", [player("host"), player("a"), bot]), player("host"))).toBeNull();
      const three = room("a", [player("host"), player("a"), player("b"), bot]);
      expect(kickActionFor(three, player("b"))).toBe("vote");
      expect(kickActionFor(three, bot)).toBeNull();
      expect(kickActionFor(room("a", three.players, ["b"]), player("b"))).toBe("voted");
    });

    it("lets only the host remove a spectator, and never counts spectators toward a vote", () => {
      const fan = player("fan", { role: "spectator" });
      const players = [player("host"), player("a"), player("b"), fan];
      expect(kickActionFor(room("host", players), fan)).toBe("kick");
      expect(kickActionFor(room("a", players), fan)).toBeNull();
      const fans = [player("host"), player("a"), fan, player("fan2", { role: "spectator" })];
      expect(kickActionFor(room("a", fans), player("host"))).toBeNull();
    });

    it("offers spectators no kick actions at all", () => {
      const players = [player("host"), player("a"), player("b"), player("fan", { role: "spectator" })];
      expect(kickActionFor(room("fan", players), player("a"))).toBeNull();
      expect(kickActionFor(room("fan", players), player("host"))).toBeNull();
    });

    it("ignores players who already left", () => {
      const gone = player("b", { left_at: "2026-01-01" });
      expect(kickActionFor(room("host", [player("host"), gone]), gone)).toBeNull();
    });
  });
});
