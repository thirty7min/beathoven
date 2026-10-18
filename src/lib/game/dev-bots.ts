import { GameError, toGameError } from "./errors";

export type DevBot = { user_id: string; username: string };

const ENDPOINT = "/api/dev/bots";

async function send(method: "POST" | "DELETE", body: Record<string, string>): Promise<Response> {
  const response = await fetch(ENDPOINT, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.status === 404) throw new GameError("dev_tools_disabled", "dev_tools_disabled");
  if (!response.ok) {
    const { error } = (await response.json().catch(() => ({}))) as { error?: string };
    throw toGameError({ message: error });
  }
  return response;
}

export async function devToolsEnabled(): Promise<boolean> {
  if (process.env.NODE_ENV !== "development") return false;
  try {
    const response = await fetch(ENDPOINT, { cache: "no-store" });
    if (!response.ok) return false;
    const { enabled } = (await response.json()) as { enabled?: boolean };
    return enabled === true;
  } catch {
    return false;
  }
}

export async function addBot(roomId: string): Promise<DevBot> {
  const response = await send("POST", { roomId });
  return ((await response.json()) as { bot: DevBot }).bot;
}

export async function removeBot(roomId: string, botId: string): Promise<void> {
  await send("DELETE", { roomId, botId });
}
