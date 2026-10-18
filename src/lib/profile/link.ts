import { toGameError } from "@/lib/game/errors";

const ENDPOINT = "/api/profile/link";

export async function saveProfileLink(url: string | null): Promise<{ linkUrl: string | null }> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const body = (await response.json().catch(() => null)) as { linkUrl?: string | null; error?: string } | null;
  if (!response.ok) throw toGameError({ message: body?.error ?? `link save failed (${response.status})` });
  return { linkUrl: body?.linkUrl ?? null };
}

export function outboundLinkPath(username: string) {
  return `/out/${encodeURIComponent(username)}`;
}
