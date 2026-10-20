import { buildEmojiIndex, type EmojiIndex } from "./emoji-shortcodes";

let loading: Promise<EmojiIndex> | null = null;

export function loadEmojiIndex(): Promise<EmojiIndex> {
  loading ??= import("emojibase-data/en/shortcodes/joypixels.json").then(
    (data) => buildEmojiIndex(data.default),
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}
