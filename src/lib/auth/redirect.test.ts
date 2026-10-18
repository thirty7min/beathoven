import { describe, expect, it } from "vitest";
import { safeNextPath } from "./redirect";

describe("safeNextPath", () => {
  it("allows same-origin paths", () => {
    expect(safeNextPath("/room/ABCDEF")).toBe("/room/ABCDEF");
    expect(safeNextPath("/u/me?x=1")).toBe("/u/me?x=1");
    expect(safeNextPath("/play#lobbies")).toBe("/play#lobbies");
    expect(safeNextPath("/")).toBe("/");
  });

  it("rejects absolute and protocol-relative URLs", () => {
    expect(safeNextPath("https://evil.com")).toBe("/");
    expect(safeNextPath("http://evil.com/room")).toBe("/");
    expect(safeNextPath("//evil.com")).toBe("/");
    expect(safeNextPath("/\\evil.com")).toBe("/");
    expect(safeNextPath("\\\\evil.com")).toBe("/");
  });

  it("rejects javascript: and other schemes", () => {
    expect(safeNextPath("javascript:alert(1)")).toBe("/");
    expect(safeNextPath("JavaScript:alert(1)")).toBe("/");
    expect(safeNextPath("data:text/html,hi")).toBe("/");
  });

  it.each([
    ["tab", "/%09/evil.com"],
    ["line feed", "/%0A/evil.com"],
    ["carriage return", "/%0D/evil.com"],
    ["encoded backslash", "/%5C/evil.com"],
    ["tab before backslash", "/%09\\evil.com"],
  ])("rejects %s smuggling once the query string is decoded", (_, raw) => {
    const next = new URLSearchParams(`next=${raw}`).get("next");
    expect(safeNextPath(next)).not.toMatch(/evil\.com/);
    expect(safeNextPath(next).startsWith("//")).toBe(false);
  });

  it("rejects decoded tab/CR/LF variants directly", () => {
    expect(safeNextPath("/\t/evil.com")).toBe("/");
    expect(safeNextPath("/\n/evil.com")).toBe("/");
    expect(safeNextPath("/\r/evil.com")).toBe("/");
    expect(safeNextPath("/\t\\evil.com")).toBe("/");
  });

  it("never returns a path that resolves off-origin", () => {
    const origin = "http://localhost:3000";
    for (const raw of ["/%09/evil.com", "/%0A/evil.com", "/%0D/evil.com", "/%5C/evil.com", "//evil.com", "/\\evil.com"]) {
      const next = safeNextPath(new URLSearchParams(`next=${raw}`).get("next"));
      expect(new URL(next, origin).origin).toBe(origin);
    }
  });

  it("falls back for empty input", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath("", "/home")).toBe("/home");
    expect(safeNextPath("relative/path")).toBe("/");
  });
});
