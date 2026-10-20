const EMOJI_ONLY = /^(?:(?:\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|\p{Emoji_Modifier})*|\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3)\s*){1,3}$/u;

type RunMessage = { user_id: string | null; created_at: string; kind?: string };

export function isEmojiOnly(body: string): boolean {
  return EMOJI_ONLY.test(body.trim());
}

export function continuesRun(previous: RunMessage | undefined, message: RunMessage, windowMs = 5 * 60_000): boolean {
  if (!previous || previous.user_id !== message.user_id) return false;
  if (previous.kind === "system" || message.kind === "system") return false;
  return Date.parse(message.created_at) - Date.parse(previous.created_at) < windowMs;
}
