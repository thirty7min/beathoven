import { describe, expect, it } from "vitest";
import { canFinishOnboarding, initialOnboarding, usernameStatus } from "./onboarding";

describe("initialOnboarding", () => {
  it("prefills from the Google name", () => {
    expect(initialOnboarding({ metadata: { full_name: "  Case   Miller " }, email: "case@x.com", currentUsername: "producer_1" })).toEqual({
      displayName: "Case Miller",
      username: "Case_Miller",
    });
  });

  it("prefers a provider handle for the username", () => {
    expect(initialOnboarding({ metadata: { global_name: "Beat Lord", user_name: "beatlord" }, email: null, currentUsername: "producer_1" })).toEqual({
      displayName: "Beat Lord",
      username: "beatlord",
    });
  });

  it("falls back to the email, then the current username", () => {
    expect(initialOnboarding({ metadata: { full_name: "李" }, email: "li.wei@x.com", currentUsername: "producer_1" }).username).toBe("liwei");
    expect(initialOnboarding({ metadata: {}, email: "a@x.com", currentUsername: "producer_1" })).toEqual({ displayName: "", username: "producer_1" });
  });

  it("trims long names to the display name limit", () => {
    expect(Array.from(initialOnboarding({ metadata: { name: "x".repeat(50) }, email: null, currentUsername: "p_1" }).displayName)).toHaveLength(32);
  });
});

describe("usernameStatus", () => {
  it("validates before checking", () => {
    expect(usernameStatus("ab", null).kind).toBe("invalid");
  });

  it("is checking until the result matches the current value", () => {
    expect(usernameStatus("case", null)).toEqual({ kind: "checking" });
    expect(usernameStatus("case", { username: "cas", available: true })).toEqual({ kind: "checking" });
  });

  it("reports availability for the current value", () => {
    expect(usernameStatus("case", { username: "case", available: true })).toEqual({ kind: "available" });
    expect(usernameStatus("case", { username: "case", available: false })).toEqual({ kind: "taken" });
    expect(usernameStatus("case", { username: "case", available: null })).toEqual({ kind: "unknown" });
  });
});

describe("canFinishOnboarding", () => {
  it("needs a valid name and a username that isn't known to be taken", () => {
    expect(canFinishOnboarding(null, { kind: "available" })).toBe(true);
    expect(canFinishOnboarding(null, { kind: "unknown" })).toBe(true);
    expect(canFinishOnboarding(null, { kind: "checking" })).toBe(false);
    expect(canFinishOnboarding(null, { kind: "taken" })).toBe(false);
    expect(canFinishOnboarding("Add a display name.", { kind: "available" })).toBe(false);
  });
});
