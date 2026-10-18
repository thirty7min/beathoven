import { assessLink, normalizeLink, type LinkCheckers, type LinkVerdict } from "./link-safety";

export type OutboundTarget = {
  user_id: string;
  username: string;
  link_url: string | null;
  checked_recently: boolean;
};

export type OutboundState =
  | { kind: "none" }
  | { kind: "ready"; url: string; hostname: string; scanned: boolean }
  | { kind: "removed"; storedUrl: string }
  | { kind: "unavailable" };

export async function resolveOutbound(target: OutboundTarget, checkers: LinkCheckers): Promise<OutboundState> {
  const storedUrl = target.link_url;
  if (!storedUrl) return { kind: "none" };
  const link = normalizeLink(storedUrl);
  if (!link.ok) return { kind: "removed", storedUrl };

  const effective: LinkCheckers = target.checked_recently ? { ...checkers, safeBrowsing: async () => "skipped" } : checkers;
  const verdict = await assessLink(link.url, link.hostname, effective).catch(
    (): LinkVerdict => ({ ok: false, code: "link_check_unavailable" }),
  );
  if (verdict.ok) return { kind: "ready", url: verdict.url, hostname: verdict.hostname, scanned: verdict.scanned };
  return verdict.code === "unsafe_link" ? { kind: "removed", storedUrl } : { kind: "unavailable" };
}
