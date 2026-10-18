const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*\s*){1,3}$/u;

type RunMessage = { user_id: string | null; created_at: string; kind?: string };

export function isEmojiOnly(body: string): boolean {
  return EMOJI_ONLY.test(body.trim());
}

export function continuesRun(previous: RunMessage | undefined, message: RunMessage, windowMs = 5 * 60_000): boolean {
  if (!previous || previous.user_id !== message.user_id) return false;
  if (previous.kind === "system" || message.kind === "system") return false;
  return Date.parse(message.created_at) - Date.parse(previous.created_at) < windowMs;
}
