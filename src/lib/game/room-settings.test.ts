import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, LISTEN_OPTIONS_SECONDS, customRuleNotes, modeInfo, PRODUCE_OPTIONS_SECONDS, SETTINGS_LIMITS, withCurrent, clamp, formatSeconds, hasCustomRules, isRoomCode, normalizeRoomCode } from "./room-settings";

describe("room settings", () => {
  it("clamps to the database ranges", () => {
    expect(clamp(1, SETTINGS_LIMITS.maxPlayers)).toBe(2);
    expect(clamp(99, SETTINGS_LIMITS.maxPlayers)).toBe(16);
    expect(clamp(42.6, SETTINGS_LIMITS.listenSeconds)).toBe(43);
    expect(clamp(Number.NaN, SETTINGS_LIMITS.produceSeconds)).toBe(60);
  });

  it("formats durations", () => {
    expect(formatSeconds(20)).toBe("20s");
    expect(formatSeconds(60)).toBe("1 min");
    expect(formatSeconds(90)).toBe("1m 30s");
    expect(formatSeconds(3600)).toBe("1h");
    expect(formatSeconds(5400)).toBe("1h 30m");
  });

  it("normalizes room codes", () => {
    expect(normalizeRoomCode(" ab-c 12d9x ")).toBe("ABC12D");
    expect(isRoomCode("ABC12D")).toBe(true);
    expect(isRoomCode("ABC12")).toBe(false);
    expect(isRoomCode("abc12d")).toBe(false);
  });

  it("flags rooms whose rules differ from the defaults", () => {
    const standard = {
      mode: "classic" as const,
      produce_seconds: DEFAULT_SETTINGS.produceSeconds,
      max_players: DEFAULT_SETTINGS.maxPlayers,
      is_private: true,
    };
    expect(hasCustomRules(standard)).toBe(false);
    expect(hasCustomRules({ ...standard, mode: "creative" })).toBe(false);
    expect(hasCustomRules({ ...standard, produce_seconds: 600 })).toBe(true);
    expect(hasCustomRules({ ...standard, mode: "premade", produce_seconds: 180 })).toBe(false);
    expect(hasCustomRules({ ...standard, max_players: 4 })).toBe(true);
    expect(hasCustomRules({ ...standard, reveal_names: true })).toBe(true);
    expect(hasCustomRules({ ...standard, listen_seconds: 45 })).toBe(false);
    expect(hasCustomRules({ ...standard, listen_seconds: null })).toBe(false);
    expect(hasCustomRules({ ...standard, listen_seconds: 60 })).toBe(true);
  });

  it("offers standard choices inside the database limits, keeping an unusual current value", () => {
    for (const s of PRODUCE_OPTIONS_SECONDS) expect(clamp(s, SETTINGS_LIMITS.produceSeconds)).toBe(s);
    for (const s of LISTEN_OPTIONS_SECONDS) expect(clamp(s, SETTINGS_LIMITS.listenSeconds)).toBe(s);
    expect(LISTEN_OPTIONS_SECONDS).toContain(DEFAULT_SETTINGS.listenSeconds);
    expect(PRODUCE_OPTIONS_SECONDS).toContain(DEFAULT_SETTINGS.produceSeconds);
    expect(withCurrent([300, 600], 600)).toEqual([300, 600]);
    expect(withCurrent([300, 600], 420)).toEqual([300, 420, 600]);
  });

  it("explains a mode and lists only the rules that differ from defaults", () => {
    expect(modeInfo({ mode: "premade" })).toEqual({
      title: "Premade",
      body: "Upload a finished track. 3 minutes to upload, no production.",
      rules: null,
    });
    expect(customRuleNotes({ mode: "premade", produce_seconds: 180, listen_seconds: 45, max_players: 8 })).toEqual([]);
    expect(modeInfo({ mode: "classic", produce_seconds: 600, listen_seconds: 60, reveal_names: true }).rules).toBe(
      "10 min to produce · Listen time 60s per track · Names shown",
    );
    expect(customRuleNotes({ mode: "creative", max_players: 4 })).toEqual(["4 players max"]);
  });
});
