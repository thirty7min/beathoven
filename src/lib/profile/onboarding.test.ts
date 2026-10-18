import { describe, expect, it, vi } from "vitest";
import type { TypedSupabaseClient } from "@/lib/supabase/client";
import { completeOnboarding, isUsernameAvailable, needsOnboarding } from "./onboarding";
import { validateDisplayName } from "./validate";

const client = (result: { data: unknown; error: { message: string } | null }) => {
  const rpc = vi.fn(async () => result);
  return { supabase: { rpc } as unknown as TypedSupabaseClient, rpc };
};

describe("needsOnboarding", () => {
  it("applies to signed-in, non-anonymous users without onboarded_at", () => {
    expect(needsOnboarding({ onboarded_at: null }, { is_anonymous: false })).toBe(true);
    expect(needsOnboarding({ onboarded_at: "2026-10-18T00:00:00Z" }, { is_anonymous: false })).toBe(false);
    expect(needsOnboarding({ onboarded_at: null }, { is_anonymous: true })).toBe(false);
    expect(needsOnboarding(null, { is_anonymous: false })).toBe(false);
    expect(needsOnboarding({ onboarded_at: null }, null)).toBe(false);
  });
});

describe("completeOnboarding", () => {
  it("normalizes input and maps server errors", async () => {
    const ok = client({ data: { id: "u" }, error: null });
    await completeOnboarding(ok.supabase, { displayName: "  DJ   Two ", username: " dj_two ", daws: ["reaper"] });
    expect(ok.rpc).toHaveBeenCalledWith("complete_onboarding", {
      p_display_name: "DJ Two",
      p_username: "dj_two",
      p_bio: "",
      p_daws: ["reaper"],
    });
    const taken = client({ data: null, error: { message: "username_taken" } });
    await expect(completeOnboarding(taken.supabase, { displayName: "A", username: "abc" })).rejects.toMatchObject({
      code: "username_taken",
    });
  });
});

describe("isUsernameAvailable", () => {
  it("skips the server for malformed names", async () => {
    const free = client({ data: true, error: null });
    expect(await isUsernameAvailable(free.supabase, "no spaces")).toBe(false);
    expect(free.rpc).not.toHaveBeenCalled();
    expect(await isUsernameAvailable(free.supabase, " fresh_name ")).toBe(true);
    expect(free.rpc).toHaveBeenCalledWith("username_available", { p_username: "fresh_name" });
  });
});

describe("validateDisplayName", () => {
  it("allows unicode and emoji up to 32 characters, nothing hidden", () => {
    expect(validateDisplayName("DJ Ünïcødé 🎧")).toBeNull();
    expect(validateDisplayName("👨‍👩‍👧 crew")).toBeNull();
    expect(validateDisplayName("🎧".repeat(32))).toBeNull();
    expect(validateDisplayName("🎧".repeat(33))).toMatch(/32/);
    expect(validateDisplayName("   ")).toMatch(/Add/);
    expect(validateDisplayName("bidi‮evil")).toMatch(/hidden/);
  });
});
