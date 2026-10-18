import type { OutboundState } from "./outbound";

export type LinkCheck =
  | { status: "ready"; url: string; hostname: string }
  | { status: "removed" }
  | { status: "unavailable" }
  | { status: "none" };

const ENDPOINT = "/api/profile/link/check";

export function linkCheckFor(state: OutboundState): LinkCheck {
  switch (state.kind) {
    case "ready":
      return { status: "ready", url: state.url, hostname: state.hostname };
    case "removed":
      return { status: "removed" };
    case "unavailable":
      return { status: "unavailable" };
    case "none":
      return { status: "none" };
  }
}

export function parseLinkCheck(body: unknown): LinkCheck {
  const value = body as Partial<{ status: string; url: unknown; hostname: unknown }> | null;
  if (value?.status === "ready" && typeof value.url === "string" && typeof value.hostname === "string" && /^https?:\/\//i.test(value.url)) {
    return { status: "ready", url: value.url, hostname: value.hostname };
  }
  if (value?.status === "removed" || value?.status === "none") return { status: value.status };
  return { status: "unavailable" };
}

export async function checkProfileLink(username: string, signal?: AbortSignal): Promise<LinkCheck> {
  try {
    const response = await fetch(`${ENDPOINT}?username=${encodeURIComponent(username)}`, { cache: "no-store", signal });
    if (!response.ok && response.status !== 404) return { status: "unavailable" };
    return parseLinkCheck(await response.json().catch(() => null));
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return { status: "unavailable" };
  }
}
