import { describe, expect, it } from "vitest";
import { GameError, toGameError } from "./errors";
import { isMissingRpc, isTransientError } from "./error-kind";

describe("isTransientError", () => {
  it("retries network and unclassified failures", () => {
    expect(isTransientError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isTransientError(toGameError({ message: "TypeError: Failed to fetch" }))).toBe(true);
    expect(isTransientError(new GameError("unknown", "boom"))).toBe(true);
    expect(isTransientError("weird")).toBe(true);
  });

  it("retries rate limiting", () => {
    expect(isTransientError(new GameError("rate_limited", "rate_limited"))).toBe(true);
  });

  it("gives up on game-rule rejections", () => {
    for (const code of ["not_member", "room_not_found", "not_authenticated", "wrong_phase", "room_closed"] as const) {
      expect(isTransientError(new GameError(code, code))).toBe(false);
    }
  });
});

describe("isMissingRpc", () => {
  it("recognises PostgREST and Postgres missing-function errors", () => {
    expect(isMissingRpc({ code: "PGRST202", message: "Could not find the function public.touch_room(p_room_id) in the schema cache" })).toBe(true);
    expect(isMissingRpc({ code: "42883", message: "function public.touch_room(uuid) does not exist" })).toBe(true);
    expect(isMissingRpc({ message: "Could not find the function public.touch_room" })).toBe(true);
  });

  it("ignores other errors and empty input", () => {
    expect(isMissingRpc({ code: "P0001", message: "not_member" })).toBe(false);
    expect(isMissingRpc({ message: "TypeError: Failed to fetch" })).toBe(false);
    expect(isMissingRpc(null)).toBe(false);
    expect(isMissingRpc(undefined)).toBe(false);
  });
});
