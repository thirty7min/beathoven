import { describe, expect, it, vi } from "vitest";
import {
  SAFE_BROWSING_THREAT_TYPES,
  checkSafeBrowsing,
  isPublicHostname,
  normalizeLink,
  vetLink,
  type LinkCheckers,
} from "./link-safety";

const ok = (input: string) => {
  const result = normalizeLink(input);
  if (!result.ok) throw new Error(`${input} rejected: ${result.code}`);
  return result;
};

const code = (input: string) => {
  const result = normalizeLink(input);
  return result.ok ? null : result.code;
};

describe("normalizeLink", () => {
  it("trims and prefixes bare domains with https", () => {
    expect(ok("  soundcloud.com/someone  ")).toEqual({
      ok: true,
      url: "https://soundcloud.com/someone",
      hostname: "soundcloud.com",
    });
    expect(ok("example.com").url).toBe("https://example.com/");
    expect(ok("https://www.youtube.com/@artist?si=1#top").url).toBe("https://www.youtube.com/@artist?si=1#top");
  });

  it("lowercases the host, strips a trailing dot and the default port", () => {
    expect(ok("HTTPS://Example.COM./Path").url).toBe("https://example.com/Path");
    expect(ok("https://example.com:443/").url).toBe("https://example.com/");
  });

  it("stores the punycode hostname", () => {
    const result = ok("https://bücher.de/x");
    expect(result.hostname).toBe("xn--bcher-kva.de");
    expect(result.url).toBe("https://xn--bcher-kva.de/x");
    expect(ok("https://example.рф").hostname).toBe("example.xn--p1ai");
  });

  it("only allows https", () => {
    for (const input of [
      "http://example.com",
      "ftp://example.com",
      "javascript:alert(1)",
      "javascript://example.com/%0aalert(1)",
      "data:text/html,hi",
      "mailto:a@example.com",
      "file:///etc/passwd",
    ]) {
      expect(code(input), input).toBe("invalid_link");
    }
  });

  it("rejects userinfo, ports, whitespace and backslashes", () => {
    for (const input of [
      "https://user@example.com",
      "https://user:pass@example.com",
      "https://example.com@evil.com",
      "https://example.com:8443/",
      "https://exa mple.com",
      "https://example.com/\nx",
      "https://evil.com\\@example.com",
      "",
      "   ",
    ]) {
      expect(code(input), JSON.stringify(input)).toBe("invalid_link");
    }
  });

  it("rejects IP literals in every spelling", () => {
    for (const input of [
      "https://127.0.0.1",
      "https://10.0.0.1/admin",
      "https://2130706433",
      "https://0x7f.0.0.1",
      "https://0177.0.0.1",
      "https://[::1]",
      "https://[2001:db8::1]/",
      "192.168.1.1",
    ]) {
      expect(code(input), input).toBe("invalid_link");
    }
  });

  it("rejects local, private and reserved hosts", () => {
    for (const input of [
      "https://localhost",
      "https://app.localhost",
      "https://printer.local",
      "https://db.internal",
      "https://router.lan",
      "https://site.test",
      "https://site.example",
      "https://site.invalid",
      "https://abc.onion",
      "https://1.0.0.127.in-addr.arpa",
      "https://intranet",
      "https://example.c",
      "https://example.123",
      "https://-bad.com",
      "https://under_score.com",
    ]) {
      expect(code(input), input).toBe("invalid_link");
    }
  });

  it("caps the stored length at 200", () => {
    const base = "https://example.com/";
    expect(ok(base + "a".repeat(200 - base.length)).url).toHaveLength(200);
    expect(code(base + "a".repeat(201 - base.length))).toBe("invalid_link");
    expect(code(`example.com/${"ü".repeat(60)}`)).toBe("invalid_link");
  });

  it("rejects URL shorteners and redirectors, including subdomains", () => {
    for (const input of [
      "bit.ly/abc",
      "https://www.bit.ly/abc",
      "https://tinyurl.com/x",
      "https://t.co/x",
      "https://goo.gl/x",
      "https://ow.ly/x",
      "https://is.gd/x",
      "https://cutt.ly/x",
      "https://rebrand.ly/x",
      "https://shorturl.at/x",
      "https://l.facebook.com/l.php?u=https://evil.com",
      "https://www.google.com/url?q=https://evil.com",
      "https://google.co.uk/url?q=https://evil.com",
      "https://www.youtube.com/redirect?q=https://evil.com",
    ]) {
      expect(code(input), input).toBe("link_shortener_not_allowed");
    }
    expect(ok("https://www.google.com/search?q=beats").hostname).toBe("www.google.com");
    expect(ok("https://notbit.ly/x").hostname).toBe("notbit.ly");
    expect(ok("https://linktr.ee/someone").hostname).toBe("linktr.ee");
  });
});

describe("isPublicHostname", () => {
  it("accepts ordinary and IDN TLDs", () => {
    expect(isPublicHostname("open.spotify.com")).toBe(true);
    expect(isPublicHostname("example.xn--p1ai")).toBe(true);
    expect(isPublicHostname("music.studio")).toBe(true);
  });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("checkSafeBrowsing", () => {
  it("skips without an API key", async () => {
    const fetchImpl = vi.fn();
    expect(await checkSafeBrowsing("https://example.com/", { apiKey: undefined, fetchImpl })).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends a v4 lookup for the four threat types", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    expect(await checkSafeBrowsing("https://example.com/", { apiKey: "k&y", fetchImpl })).toBe("safe");
    const [endpoint, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(endpoint).toBe("https://safebrowsing.googleapis.com/v4/threatMatches:find?key=k%26y");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.threatInfo.threatTypes).toEqual([...SAFE_BROWSING_THREAT_TYPES]);
    expect(body.threatInfo.threatEntries).toEqual([{ url: "https://example.com/" }]);
    expect(body.threatInfo.platformTypes).toEqual(["ANY_PLATFORM"]);
    expect(body.threatInfo.threatEntryTypes).toEqual(["URL"]);
  });

  it("reports matches as unsafe", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ matches: [{ threatType: "MALWARE" }] }));
    expect(await checkSafeBrowsing("https://evil.com/", { apiKey: "k", fetchImpl })).toBe("unsafe");
  });

  it("fails closed on HTTP errors, bad bodies, network errors and timeouts", async () => {
    const cases: (typeof fetch)[] = [
      async () => jsonResponse({ error: "quota" }, 429),
      async () => jsonResponse({ error: "bad key" }, 400),
      async () => new Response("not json"),
      async () => jsonResponse(null),
      async () => {
        throw new TypeError("fetch failed");
      },
      (_input, init) =>
        new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
    ];
    for (const fetchImpl of cases) {
      expect(await checkSafeBrowsing("https://example.com/", { apiKey: "k", fetchImpl, timeoutMs: 20 })).toBe("unavailable");
    }
  });
});

describe("vetLink", () => {
  const checkers = (overrides: Partial<LinkCheckers> = {}): LinkCheckers => ({
    isBlockedDomain: async () => false,
    safeBrowsing: async () => "safe",
    ...overrides,
  });

  it("returns the normalized link when every check passes", async () => {
    expect(await vetLink("example.com/me", checkers())).toEqual({
      ok: true,
      url: "https://example.com/me",
      hostname: "example.com",
      scanned: true,
    });
    expect(await vetLink("example.com", checkers({ safeBrowsing: async () => "skipped" }))).toMatchObject({
      ok: true,
      scanned: false,
    });
  });

  it("stops at the first failing check", async () => {
    const safeBrowsing = vi.fn(async () => "safe" as const);
    expect(await vetLink("http://example.com", checkers({ safeBrowsing }))).toEqual({ ok: false, code: "invalid_link" });
    expect(await vetLink("bit.ly/x", checkers({ safeBrowsing }))).toEqual({ ok: false, code: "link_shortener_not_allowed" });
    const isBlockedDomain = vi.fn(async () => true);
    expect(await vetLink("sub.evil.com", checkers({ isBlockedDomain, safeBrowsing }))).toEqual({ ok: false, code: "unsafe_link" });
    expect(isBlockedDomain).toHaveBeenCalledWith("sub.evil.com");
    expect(safeBrowsing).not.toHaveBeenCalled();
  });

  it("maps Safe Browsing results", async () => {
    expect(await vetLink("example.com", checkers({ safeBrowsing: async () => "unsafe" }))).toEqual({
      ok: false,
      code: "unsafe_link",
    });
    expect(await vetLink("example.com", checkers({ safeBrowsing: async () => "unavailable" }))).toEqual({
      ok: false,
      code: "link_check_unavailable",
    });
  });
});
