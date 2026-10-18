import { describe, expect, it } from "vitest";
import { isOwnSubmission, revealedProducer } from "./room-extras";
import type { Room, RoomPlayer, Submission } from "./types";

const room = { id: "r", host_id: "a", reveal_names: false } as Room;
const players = [{ user_id: "a", username: "alice" }, { user_id: "b", username: "bob" }] as RoomPlayer[];
const track: Submission = { id: "t", user_id: "b", storage_path: "", duration_ms: 1000, submitted_at: null };

describe("revealedProducer", () => {
  it("stays hidden in blind rooms even if an id slipped through", () => {
    expect(revealedProducer({ room, players }, track)).toBeNull();
  });

  it("names the producer in reveal rooms when the server sends one", () => {
    const open = { ...room, reveal_names: true };
    expect(revealedProducer({ room: open, players }, track)?.username).toBe("bob");
    expect(revealedProducer({ room: open, players }, { ...track, user_id: null })).toBeNull();
    expect(revealedProducer({ room: open, players }, null)).toBeNull();
  });
});

describe("isOwnSubmission", () => {
  it("matches your own entry by id, not by user_id", () => {
    expect(isOwnSubmission({ my_submission: { ...track, user_id: "me", confirmed: true, clip_start_ms: 0, clip_end_ms: 1000 } }, { ...track, user_id: null })).toBe(true);
    expect(isOwnSubmission({ my_submission: null }, track)).toBe(false);
    expect(isOwnSubmission({}, track)).toBe(false);
    expect(isOwnSubmission({ my_submission: { ...track, confirmed: false, clip_start_ms: 0, clip_end_ms: 1000 } }, null)).toBe(false);
  });
});
