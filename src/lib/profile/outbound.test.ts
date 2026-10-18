import { describe, expect, it, vi } from "vitest";
import type { LinkCheckers } from "./link-safety";
import { resolveOutbound, type OutboundTarget } from "./outbound";

const target = (overrides: Partial<OutboundTarget> = {}): OutboundTarget => ({
  user_id: "u1",
  username: "producer",
  link_url: "https://example.com/me",
  checked_recently: false,
  ...overrides,
});

const checkers = (overrides: Partial<LinkCheckers> = {}): LinkCheckers => ({
  isBlockedDomain: async () => false,
  safeBrowsing: async () => "safe",
  ...overrides,
});

describe("resolveOutbound", () => {
  it("has nothing to show without a link", async () => {
    expect(await resolveOutbound(target({ link_url: null }), checkers())).toEqual({ kind: "none" });
  });

  it("re-checks Safe Browsing when the cache is stale", async () => {
    const safeBrowsing = vi.fn(async () => "safe" as const);
    expect(await resolveOutbound(target(), checkers({ safeBrowsing }))).toEqual({
      kind: "ready",
      url: "https://example.com/me",
      hostname: "example.com",
      scanned: true,
    });
    expect(safeBrowsing).toHaveBeenCalledWith("https://example.com/me");
  });

  it("skips Safe Browsing but still checks the blocklist when recently checked", async () => {
    const safeBrowsing = vi.fn(async () => "unsafe" as const);
    expect(await resolveOutbound(target({ checked_recently: true }), checkers({ safeBrowsing }))).toMatchObject({
      kind: "ready",
      scanned: false,
    });
    expect(safeBrowsing).not.toHaveBeenCalled();
    expect(
      await resolveOutbound(target({ checked_recently: true }), checkers({ isBlockedDomain: async () => true })),
    ).toEqual({ kind: "removed", storedUrl: "https://example.com/me" });
  });

  it("removes links that are now unsafe or no longer allowed", async () => {
    expect(await resolveOutbound(target(), checkers({ safeBrowsing: async () => "unsafe" }))).toEqual({
      kind: "removed",
      storedUrl: "https://example.com/me",
    });
    expect(await resolveOutbound(target({ link_url: "https://bit.ly/x" }), checkers())).toEqual({
      kind: "removed",
      storedUrl: "https://bit.ly/x",
    });
  });

  it("withholds the link when the check is unavailable", async () => {
    expect(await resolveOutbound(target(), checkers({ safeBrowsing: async () => "unavailable" }))).toEqual({
      kind: "unavailable",
    });
    expect(
      await resolveOutbound(
        target(),
        checkers({
          isBlockedDomain: async () => {
            throw new Error("db down");
          },
        }),
      ),
    ).toEqual({ kind: "unavailable" });
  });
});
