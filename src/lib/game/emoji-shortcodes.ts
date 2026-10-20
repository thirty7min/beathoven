export type EmojiEntry = { glyph: string; names: string[] };

export type EmojiIndex = { entries: EmojiEntry[]; byName: Map<string, string> };

export type EmojiMatch = { glyph: string; name: string };

export type EmojiToken = { start: number; query: string };

export const MIN_QUERY_LENGTH = 2;

export const MAX_MATCHES = 8;

const POPULAR = ["😂", "😭", "💀", "🔥", "❤️", "💯", "🙏", "👀", "👍", "😍", "🤣", "😅", "🥺", "😎", "🤔", "😊", "🙌", "👏", "✨", "🎵", "🎶", "🎧", "🎤", "🥶", "😤", "😮", "😳", "😢", "😡", "🤯", "🥳", "🎉", "💪", "👋", "😁", "😉", "🙂", "😏", "🤝", "👌"];

const POPULARITY = new Map(POPULAR.map((glyph, rank) => [glyph, rank]));

const SKIN_TONE = /1F3F[B-F]/;
const LONE_REGIONAL_INDICATOR = /^1F1[E-F][0-9A-F]$/;
const SHORTCODE_CHAR = /^[\w+-]*$/;
const COMPLETE_SHORTCODE = /:([\w+-]+):/g;
const BOUNDARY = /[\s\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}️⃣]/u;

export function hexToGlyph(hexcode: string): string {
  const glyph = String.fromCodePoint(...hexcode.split("-").map((hex) => parseInt(hex, 16)));
  return [...glyph].length === 1 && !/\p{Emoji_Presentation}/u.test(glyph) ? `${glyph}️` : glyph;
}

export function buildEmojiIndex(dataset: Record<string, string | string[]>): EmojiIndex {
  const entries: EmojiEntry[] = [];
  const byName = new Map<string, string>();
  for (const [hexcode, shortcodes] of Object.entries(dataset)) {
    if (SKIN_TONE.test(hexcode) || LONE_REGIONAL_INDICATOR.test(hexcode)) continue;
    const glyph = hexToGlyph(hexcode);
    const names = [shortcodes].flat().map((name) => name.toLowerCase());
    entries.push({ glyph, names });
    for (const name of names) if (!byName.has(name)) byName.set(name, glyph);
  }
  return { entries, byName };
}

function isBoundary(text: string, index: number): boolean {
  const previous = Array.from(text.slice(0, index)).at(-1);
  return previous === undefined || BOUNDARY.test(previous);
}

export function emojiToken(text: string, caret: number): EmojiToken | null {
  const before = text.slice(0, caret);
  const start = before.lastIndexOf(":");
  if (start === -1) return null;
  const query = before.slice(start + 1);
  if (!SHORTCODE_CHAR.test(query) || !isBoundary(text, start)) return null;
  return { start, query };
}

export function searchEmoji(index: EmojiIndex, query: string, limit = MAX_MATCHES): EmojiMatch[] {
  const needle = query.toLowerCase();
  if (needle.length < MIN_QUERY_LENGTH) return [];
  const ranked: { match: EmojiMatch; kind: number; popularity: number }[] = [];
  for (const entry of index.entries) {
    let best: { name: string; kind: number } | null = null;
    for (const name of entry.names) {
      const kind = name.startsWith(needle) ? 0 : name.includes(needle) ? 1 : -1;
      if (kind === -1) continue;
      if (!best || kind < best.kind || (kind === best.kind && name.length < best.name.length)) best = { name, kind };
    }
    if (best) ranked.push({ match: { glyph: entry.glyph, name: best.name }, kind: best.kind, popularity: POPULARITY.get(entry.glyph) ?? POPULAR.length });
  }
  ranked.sort(
    (a, b) =>
      a.kind - b.kind || a.popularity - b.popularity || a.match.name.length - b.match.name.length || a.match.name.localeCompare(b.match.name),
  );
  return ranked.slice(0, limit).map((r) => r.match);
}

export function insertEmoji(text: string, token: EmojiToken, caret: number, glyph: string): { text: string; caret: number } {
  return { text: text.slice(0, token.start) + glyph + text.slice(caret), caret: token.start + glyph.length };
}

export function completeShortcode(text: string, caret: number, index: EmojiIndex): { text: string; caret: number } | null {
  if (text[caret - 1] !== ":") return null;
  const token = emojiToken(text, caret - 1);
  if (!token || !token.query) return null;
  const glyph = index.byName.get(token.query.toLowerCase());
  return glyph ? insertEmoji(text, token, caret, glyph) : null;
}

export function replaceShortcodes(text: string, index: EmojiIndex): string {
  let replacedEnd = -1;
  return text.replace(COMPLETE_SHORTCODE, (code: string, name: string, offset: number) => {
    const glyph = index.byName.get(name.toLowerCase());
    if (!glyph || (offset !== replacedEnd && !isBoundary(text, offset))) return code;
    replacedEnd = offset + code.length;
    return glyph;
  });
}
