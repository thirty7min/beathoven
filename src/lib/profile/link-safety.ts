export const MAX_LINK_LENGTH = 200;

export type LinkErrorCode =
  | "invalid_link"
  | "unsafe_link"
  | "link_shortener_not_allowed"
  | "link_check_unavailable"
  | "link_rate_limited";

export type NormalizedLink = { ok: true; url: string; hostname: string } | { ok: false; code: LinkErrorCode };

const RESERVED_TLDS = new Set([
  "local",
  "localhost",
  "localdomain",
  "internal",
  "intranet",
  "private",
  "corp",
  "home",
  "lan",
  "test",
  "example",
  "invalid",
  "onion",
  "arpa",
  "alt",
]);

const SHORTENER_DOMAINS = [
  "bit.ly",
  "bitly.com",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "ow.ly",
  "is.gd",
  "v.gd",
  "cutt.ly",
  "rebrand.ly",
  "shorturl.at",
  "buff.ly",
  "tiny.cc",
  "rb.gy",
  "t.ly",
  "bl.ink",
  "s.id",
  "lnkd.in",
  "soo.gd",
  "clck.ru",
  "short.io",
  "shorte.st",
  "adf.ly",
  "bc.vc",
  "qr.ae",
  "x.co",
  "tr.im",
  "urlz.fr",
  "u.to",
  "rotf.lol",
  "linkd.in",
  "href.li",
  "l.facebook.com",
  "lm.facebook.com",
  "l.instagram.com",
  "out.reddit.com",
  "safelinks.protection.outlook.com",
  "urldefense.com",
  "urldefense.proofpoint.com",
];

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const FORBIDDEN_CHARACTERS = /[\s\u0000-\u001f\u007f\\]/;
const IPV4 = /^\d+(?:\.\d+){3}$/;
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

export function hostMatches(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function isShortener(hostname: string) {
  return SHORTENER_DOMAINS.some((domain) => hostMatches(hostname, domain));
}

function isRedirectorPath(hostname: string, pathname: string) {
  if (/^(?:www\.)?google\.[a-z.]+$/.test(hostname)) return pathname === "/url";
  if (hostMatches(hostname, "youtube.com")) return pathname === "/redirect";
  return false;
}

export function isPublicHostname(hostname: string) {
  if (hostname.length > 253 || IPV4.test(hostname) || hostname.startsWith("[")) return false;
  const labels = hostname.split(".");
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) return false;
  const tld = labels[labels.length - 1];
  return TLD.test(tld) && !RESERVED_TLDS.has(tld);
}

export function normalizeLink(input: string): NormalizedLink {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > MAX_LINK_LENGTH * 2 || FORBIDDEN_CHARACTERS.test(trimmed)) {
    return { ok: false, code: "invalid_link" };
  }

  let url: URL;
  try {
    url = new URL(SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return { ok: false, code: "invalid_link" };
  }

  if (url.protocol !== "https:" || url.username || url.password || url.port) return { ok: false, code: "invalid_link" };

  const hostname = url.hostname.replace(/\.$/, "");
  if (!isPublicHostname(hostname)) return { ok: false, code: "invalid_link" };
  url.hostname = hostname;

  if (url.href.length > MAX_LINK_LENGTH) return { ok: false, code: "invalid_link" };
  if (isShortener(hostname) || isRedirectorPath(hostname, url.pathname)) {
    return { ok: false, code: "link_shortener_not_allowed" };
  }
  return { ok: true, url: url.href, hostname };
}

export type SafeBrowsingResult = "safe" | "unsafe" | "unavailable" | "skipped";

export const SAFE_BROWSING_THREAT_TYPES = [
  "MALWARE",
  "SOCIAL_ENGINEERING",
  "UNWANTED_SOFTWARE",
  "POTENTIALLY_HARMFUL_APPLICATION",
] as const;

const SAFE_BROWSING_ENDPOINT = "https://safebrowsing.googleapis.com/v4/threatMatches:find";

export type SafeBrowsingOptions = {
  apiKey: string | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export async function checkSafeBrowsing(
  url: string,
  { apiKey, fetchImpl = fetch, timeoutMs = 3000 }: SafeBrowsingOptions,
): Promise<SafeBrowsingResult> {
  if (!apiKey) return "skipped";
  try {
    const response = await fetchImpl(`${SAFE_BROWSING_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client: { clientId: "beathoven", clientVersion: "1.0.0" },
        threatInfo: {
          threatTypes: SAFE_BROWSING_THREAT_TYPES,
          platformTypes: ["ANY_PLATFORM"],
          threatEntryTypes: ["URL"],
          threatEntries: [{ url }],
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!response.ok) return "unavailable";
    const body = (await response.json()) as { matches?: unknown };
    if (body === null || typeof body !== "object") return "unavailable";
    return Array.isArray(body.matches) && body.matches.length > 0 ? "unsafe" : "safe";
  } catch {
    return "unavailable";
  }
}

export type LinkCheckers = {
  isBlockedDomain: (hostname: string) => Promise<boolean>;
  safeBrowsing: (url: string) => Promise<SafeBrowsingResult>;
};

export type LinkVerdict =
  | { ok: true; url: string; hostname: string; scanned: boolean }
  | { ok: false; code: LinkErrorCode };

export async function assessLink(url: string, hostname: string, checkers: LinkCheckers): Promise<LinkVerdict> {
  if (await checkers.isBlockedDomain(hostname)) return { ok: false, code: "unsafe_link" };
  const scan = await checkers.safeBrowsing(url);
  if (scan === "unsafe") return { ok: false, code: "unsafe_link" };
  if (scan === "unavailable") return { ok: false, code: "link_check_unavailable" };
  return { ok: true, url, hostname, scanned: scan === "safe" };
}

export async function vetLink(input: string, checkers: LinkCheckers): Promise<LinkVerdict> {
  const link = normalizeLink(input);
  if (!link.ok) return link;
  return assessLink(link.url, link.hostname, checkers);
}
