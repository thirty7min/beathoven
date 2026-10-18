import { describe, expect, it } from "vitest";
import { GAME_ERROR_CODES, GameError, toGameError } from "./errors";
import { friendlyError } from "./error-messages";

describe("friendlyError", () => {
  it("has a message for every RPC error code", () => {
    for (const code of GAME_ERROR_CODES) {
      expect(friendlyError(new GameError(code, code)), code).not.toMatch(/Something went wrong/);
    }
    expect(friendlyError(new GameError("upload_failed", "x"))).toMatch(/Upload failed/);
  });

  it("maps errors from the RPC layer", () => {
    expect(friendlyError(toGameError({ message: "room_full" }))).toBe("That room is full.");
    expect(friendlyError({ message: "rate_limited" })).toMatch(/too fast/);
  });

  it("maps Postgres constraint errors", () => {
    expect(friendlyError({ code: "23505", message: "duplicate key value" })).toMatch(/taken/);
  });

  it("detects network failures and falls back otherwise", () => {
    expect(friendlyError(new TypeError("Failed to fetch"))).toMatch(/Network/);
    expect(friendlyError(new Error("weird"))).toMatch(/Something went wrong/);
    expect(friendlyError(null, "nope")).toBe("nope");
  });
});
