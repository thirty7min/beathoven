import { describe, expect, it } from "vitest";
import { continuesRun, isEmojiOnly } from "./chat";

describe("isEmojiOnly", () => {
  it("accepts quick reactions and short emoji runs", () => {
    for (const emoji of ["🔥", "💀", "❤️", "👋", "🎵", "🔥🔥", "👋🏽", "👨‍🎤", " 🔥 🔥 ", "🇺🇸", "1️⃣", "❤️❤️"]) expect(isEmojiOnly(emoji)).toBe(true);
  });

  it("rejects text, long runs and digits", () => {
    for (const body of ["fire 🔥", "lol", "🔥🔥🔥🔥", "1", "", "#"]) expect(isEmojiOnly(body)).toBe(false);
  });
});

describe("continuesRun", () => {
  const at = (iso: string, user_id = "a") => ({ user_id, created_at: iso });

  it("groups consecutive messages from the same sender", () => {
    expect(continuesRun(at("2026-01-01T00:00:00Z"), at("2026-01-01T00:01:00Z"))).toBe(true);
  });

  it("starts a new run for another sender, the first message, or after a long gap", () => {
    expect(continuesRun(undefined, at("2026-01-01T00:00:00Z"))).toBe(false);
    expect(continuesRun(at("2026-01-01T00:00:00Z", "b"), at("2026-01-01T00:00:10Z"))).toBe(false);
    expect(continuesRun(at("2026-01-01T00:00:00Z"), at("2026-01-01T00:06:00Z"))).toBe(false);
  });

  it("never groups system lines", () => {
    const system = { ...at("2026-01-01T00:00:10Z"), kind: "system" };
    expect(continuesRun(at("2026-01-01T00:00:00Z"), system)).toBe(false);
    expect(continuesRun(system, at("2026-01-01T00:00:20Z"))).toBe(false);
  });
});
