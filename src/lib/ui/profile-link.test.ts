import { describe, expect, it } from "vitest";
import { linkHostname, normalizeLinkInput } from "./profile-link";

describe("normalizeLinkInput", () => {
  it("treats blank as clearing the link", () => {
    expect(normalizeLinkInput("   ")).toBeNull();
  });

  it("adds https:// to bare domains and keeps explicit schemes", () => {
    expect(normalizeLinkInput(" soundcloud.com/you ")).toBe("https://soundcloud.com/you");
    expect(normalizeLinkInput("https://example.com")).toBe("https://example.com");
    expect(normalizeLinkInput("http://example.com")).toBe("http://example.com");
  });
});

describe("linkHostname", () => {
  it("shows the bare host without www", () => {
    expect(linkHostname("https://www.soundcloud.com/you?x=1")).toBe("soundcloud.com");
    expect(linkHostname("https://beats.example.org/a")).toBe("beats.example.org");
  });

  it("returns null for missing or broken links", () => {
    expect(linkHostname(null)).toBeNull();
    expect(linkHostname("not a url")).toBeNull();
  });
});
