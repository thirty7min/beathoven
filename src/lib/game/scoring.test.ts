import { describe, expect, it } from "vitest";
import { outcome, scoreRound } from "./scoring";

const subs = (...users: string[]) => users.map((u) => ({ submissionId: `s-${u}`, userId: u }));
const votes = (submission: string, ...scores: number[]) => scores.map((score) => ({ submissionId: `s-${submission}`, score }));

describe("scoreRound", () => {
  it("ranks by average and picks a sole winner", () => {
    const result = scoreRound(subs("a", "b"), [...votes("a", 5, 4), ...votes("b", 3)]);
    expect(result.map((r) => [r.userId, r.average, r.rank, r.isWinner])).toEqual([
      ["a", 4.5, 1, true],
      ["b", 3, 2, false],
    ]);
    expect(outcome(result)).toEqual({ kind: "winner", userId: "a" });
  });

  it("ties equal averages exactly, even with different vote counts", () => {
    const result = scoreRound(subs("a", "b", "c"), [
      ...votes("a", 4, 4, 5),
      ...votes("b", 5, 4, 4, 4, 5, 4),
      ...votes("c", 1),
    ]);
    expect(result.map((r) => [r.userId, r.rank, r.isWinner])).toEqual([
      ["a", 1, true],
      ["b", 1, true],
      ["c", 3, false],
    ]);
    expect(outcome(result)).toEqual({ kind: "tie", userIds: ["a", "b"] });
  });

  it("separates close but different averages", () => {
    const result = scoreRound(subs("a", "b"), [...votes("a", 1, 2), ...votes("b", 1, 1, 2, 2, 2)]);
    expect(result.find((r) => r.userId === "b")!.isWinner).toBe(true);
    expect(result.find((r) => r.userId === "a")!.isWinner).toBe(false);
  });

  it("puts unvoted submissions last and never makes them winners", () => {
    const result = scoreRound(subs("a", "b", "c"), votes("b", 1));
    expect(result.map((r) => [r.userId, r.average, r.rank, r.isWinner])).toEqual([
      ["b", 1, 1, true],
      ["a", null, 2, false],
      ["c", null, 2, false],
    ]);
  });

  it("has no winner when nobody voted or nobody submitted", () => {
    expect(outcome(scoreRound(subs("a", "b"), []))).toEqual({ kind: "none" });
    expect(scoreRound([], [])).toEqual([]);
  });
});
