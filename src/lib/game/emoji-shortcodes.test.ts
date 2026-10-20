import { describe, expect, it } from "vitest";
import joypixels from "emojibase-data/en/shortcodes/joypixels.json";
import { buildEmojiIndex, completeShortcode, emojiToken, hexToGlyph, insertEmoji, replaceShortcodes, searchEmoji } from "./emoji-shortcodes";
import { isEmojiOnly } from "./chat";

const index = buildEmojiIndex(joypixels);

describe("hexToGlyph", () => {
  it("adds the emoji presentation selector to text-default code points", () => {
    expect(hexToGlyph("2764")).toBe("❤️");
    expect(hexToGlyph("1F62D")).toBe("😭");
    expect(hexToGlyph("0031-FE0F-20E3")).toBe("1️⃣");
  });
});

describe("buildEmojiIndex", () => {
  it("drops skin tone variants and lone regional indicators", () => {
    const small = buildEmojiIndex({ "1F44D": ["thumbsup", "+1"], "1F44D-1F3FB": "thumbsup_tone1", "1F1FA": "regional_indicator_u" });
    expect(small.entries).toEqual([{ glyph: "👍", names: ["thumbsup", "+1"] }]);
    expect(small.byName.get("+1")).toBe("👍");
  });

  it("knows the common aliases", () => {
    const expected = { joy: "😂", fire: "🔥", skull: "💀", "100": "💯", pray: "🙏", heart: "❤️", sob: "😭", eyes: "👀" };
    for (const [name, glyph] of Object.entries(expected)) expect(index.byName.get(name)).toBe(glyph);
  });
});

describe("emojiToken", () => {
  it("reads the text from the last colon to the caret", () => {
    expect(emojiToken(":so", 3)).toEqual({ start: 0, query: "so" });
    expect(emojiToken("gg :fi", 6)).toEqual({ start: 3, query: "fi" });
    expect(emojiToken("gg :fire later", 8)).toEqual({ start: 3, query: "fire" });
    expect(emojiToken("🔥:fi", 5)).toEqual({ start: 2, query: "fi" });
  });

  it("ignores URLs, times, spaces and text without a colon", () => {
    expect(emojiToken("https://so", 10)).toBeNull();
    expect(emojiToken("at 12:30", 8)).toBeNull();
    expect(emojiToken("hey:so", 6)).toBeNull();
    expect(emojiToken(":so cool", 8)).toBeNull();
    expect(emojiToken("no colon", 8)).toBeNull();
  });
});

describe("searchEmoji", () => {
  it("waits for two characters after the colon", () => {
    expect(searchEmoji(index, "s")).toEqual([]);
    expect(searchEmoji(index, "so").length).toBeGreaterThan(0);
  });

  it("ranks popular prefix matches first and caps the list", () => {
    const results = searchEmoji(index, "so");
    expect(results[0]).toEqual({ glyph: "😭", name: "sob" });
    expect(results.map((r) => r.name)).toContain("soccer");
    expect(results).toHaveLength(8);
  });

  it("puts prefix matches ahead of substring matches", () => {
    const names = searchEmoji(index, "fire", 20).map((r) => r.name);
    expect(names[0]).toBe("fire");
    const firstSubstring = names.findIndex((name) => !name.startsWith("fire"));
    expect(names.slice(firstSubstring).every((name) => !name.startsWith("fire"))).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(searchEmoji(index, "SO")[0]?.name).toBe("sob");
  });
});

describe("insertEmoji", () => {
  it("replaces the token and puts the caret after the emoji", () => {
    expect(insertEmoji("hi :so there", { start: 3, query: "so" }, 6, "😭")).toEqual({ text: "hi 😭 there", caret: 5 });
  });
});

describe("completeShortcode", () => {
  it("replaces a known code when its closing colon is typed", () => {
    expect(completeShortcode("lol :sob:", 9, index)).toEqual({ text: "lol 😭", caret: 6 });
    expect(completeShortcode("🔥:fire:", 8, index)).toEqual({ text: "🔥🔥", caret: 4 });
  });

  it("leaves unknown codes, times and unfinished codes alone", () => {
    expect(completeShortcode(":notanemoji:", 12, index)).toBeNull();
    expect(completeShortcode("12:30:", 6, index)).toBeNull();
    expect(completeShortcode(":sob", 4, index)).toBeNull();
    expect(completeShortcode("::", 2, index)).toBeNull();
  });
});

describe("replaceShortcodes", () => {
  it("replaces every complete known code", () => {
    expect(replaceShortcodes("gg :fire: :100:", index)).toBe("gg 🔥 💯");
    expect(replaceShortcodes(":fire::fire:", index)).toBe("🔥🔥");
    expect(replaceShortcodes(":SOB:", index)).toBe("😭");
  });

  it("keeps unknown codes, URLs and times as text", () => {
    expect(replaceShortcodes(":nope: :sob:", index)).toBe(":nope: 😭");
    expect(replaceShortcodes("see https://x.y/:sob:", index)).toBe("see https://x.y/:sob:");
    expect(replaceShortcodes("at 12:30:00", index)).toBe("at 12:30:00");
  });

  it("turns a code-only message into an emoji-only one", () => {
    expect(isEmojiOnly(replaceShortcodes(":skull: :skull:", index))).toBe(true);
    expect(isEmojiOnly(replaceShortcodes(":flag_us:", index))).toBe(true);
    expect(isEmojiOnly(replaceShortcodes(":one:", index))).toBe(true);
  });
});
