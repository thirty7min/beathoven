import { describe, expect, it } from "vitest";
import { canVoteSkip, skipLabel, skipVotesNeeded } from "./skip";

describe("skipVotesNeeded", () => {
  it("is a strict majority of fresh humans", () => {
    expect([1, 2, 3, 4, 5, 10].map(skipVotesNeeded)).toEqual([1, 2, 2, 3, 3, 6]);
  });
});

describe("canVoteSkip", () => {
  const skip = { submission_id: "s1", votes: 1, needed: 2 };

  it("allows a vote on the current track, your own included, until you've voted", () => {
    expect(canVoteSkip(skip, "s1")).toBe(true);
    expect(canVoteSkip({ ...skip, you_voted: true }, "s1")).toBe(false);
    expect(canVoteSkip(skip, "s2")).toBe(false);
    expect(canVoteSkip(null, "s1")).toBe(false);
    expect(canVoteSkip({ ...skip, votes: 2 }, "s1")).toBe(false);
  });
});

describe("skipLabel", () => {
  it("shows votes over the threshold", () => {
    expect(skipLabel({ votes: 1, needed: 2 })).toBe("Skip 1/2");
  });
});
