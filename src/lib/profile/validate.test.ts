import { describe, expect, it } from "vitest";
import { escapeLike, suggestUsername, validateAvatarUrl, validateBio, validateProfile, validateUsername } from "./validate";

describe("profile validation", () => {
  it("matches the database username rule", () => {
    expect(validateUsername("ab")).not.toBeNull();
    expect(validateUsername("abc")).toBeNull();
    expect(validateUsername("a".repeat(24))).toBeNull();
    expect(validateUsername("a".repeat(25))).not.toBeNull();
    expect(validateUsername("dj khaled")).not.toBeNull();
    expect(validateUsername("beat_maker_9")).toBeNull();
  });

  it("suggests a valid username from free text", () => {
    expect(suggestUsername("  DJ  Spinz! ")).toBe("DJ_Spinz");
    expect(suggestUsername("x".repeat(40))).toHaveLength(24);
  });

  it("accepts empty or http(s) avatar URLs", () => {
    expect(validateAvatarUrl("")).toBeNull();
    expect(validateAvatarUrl("https://cdn.example.com/a.png")).toBeNull();
    expect(validateAvatarUrl("javascript:alert(1)")).not.toBeNull();
    expect(validateAvatarUrl("not a url")).not.toBeNull();
    expect(validateAvatarUrl(`https://x.com/${"a".repeat(600)}`)).not.toBeNull();
  });

  it("limits bios to 500 characters", () => {
    expect(validateBio("a".repeat(500))).toBeNull();
    expect(validateBio("a".repeat(501))).not.toBeNull();
  });

  it("collects field errors", () => {
    expect(validateProfile({ username: " ok_name ", avatarUrl: "", bio: "" })).toEqual({});
    expect(Object.keys(validateProfile({ username: "!", avatarUrl: "ftp://x", bio: "a".repeat(501) }))).toEqual([
      "username",
      "avatarUrl",
      "bio",
    ]);
  });

  it("escapes LIKE wildcards", () => {
    expect(escapeLike("beat_maker")).toBe("beat\\_maker");
    expect(escapeLike("100%\\")).toBe("100\\%\\\\");
  });
});
