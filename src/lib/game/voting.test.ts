import { describe, expect, it } from "vitest";
import type { Submission } from "./types";
import { DEFAULT_SCORE, sendVoteQuietly, voteProgress, voteState } from "./voting";

const track: Submission = { id: "t1", user_id: "author", storage_path: "x", duration_ms: 1000, submitted_at: "" };
const base = { submission: track, isMine: false, myVotes: [], trackStarted: true, trackEnded: false };

describe("voteState", () => {
  it("is unavailable with no current track", () => {
    expect(voteState({ ...base, submission: null })).toEqual({ kind: "unavailable" });
  });

  it("never lets you rate your own track", () => {
    expect(voteState({ ...base, isMine: true })).toEqual({ kind: "own_track" });
  });

  it("starts every track at the default score", () => {
    expect(voteState(base)).toEqual({ kind: "open", score: DEFAULT_SCORE, saved: false });
  });

  it("stays open after voting so the rating can change, showing the saved score", () => {
    expect(voteState({ ...base, myVotes: [{ submission_id: "t1", score: 5 }] })).toEqual({ kind: "open", score: 5, saved: true });
    expect(voteState({ ...base, myVotes: [{ submission_id: "t0", score: 2 }] })).toMatchObject({ score: DEFAULT_SCORE, saved: false });
  });

  it("waits for the lead-in and closes when the clip ends", () => {
    expect(voteState({ ...base, trackStarted: false })).toMatchObject({ kind: "waiting" });
    expect(voteState({ ...base, trackEnded: true, myVotes: [{ submission_id: "t1", score: 4 }] })).toEqual({ kind: "closed", score: 4, saved: true });
  });
});

describe("voteProgress", () => {
  it("counts eligible voters excluding the author", () => {
    const votes = [
      { submission_id: "t1", voter_id: "a" },
      { submission_id: "t0", voter_id: "b" },
      { submission_id: "t1", voter_id: "gone" },
    ];
    expect(voteProgress(track, votes, ["author", "a", "b"])).toEqual({ voted: 1, eligible: 2 });
    expect(voteProgress(null, votes, ["a"])).toEqual({ voted: 0, eligible: 0 });
  });
});

describe("sendVoteQuietly", () => {
  const transient = (e: unknown) => e === "network";

  it("retries a transient failure once", async () => {
    let calls = 0;
    const send = async () => {
      calls++;
      if (calls === 1) throw "network";
    };
    expect(await sendVoteQuietly(send, transient)).toBe(true);
    expect(calls).toBe(2);
  });

  it("gives up silently on permanent errors like already_voted", async () => {
    let calls = 0;
    const send = async () => {
      calls++;
      throw "already_voted";
    };
    expect(await sendVoteQuietly(send, transient)).toBe(false);
    expect(calls).toBe(1);
  });

  it("never throws even when the retry fails", async () => {
    await expect(sendVoteQuietly(() => Promise.reject("network"), transient)).resolves.toBe(false);
  });
});
