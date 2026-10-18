const SENTINEL_ORIGIN = "https://next.invalid";

/**
 * Only same-origin paths. Resolves with the real URL parser (which strips
 * tab/CR/LF and treats `\` as `/`) so `/\t/evil.com` can't sneak past a string check.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/")) return fallback;
  let url: URL;
  try {
    url = new URL(next, SENTINEL_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== SENTINEL_ORIGIN) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
