import { describe, expect, it } from "vitest";
import { linkCheckFor, parseLinkCheck } from "./link-check";

describe("linkCheckFor", () => {
  it("exposes only the vetted url and hostname when ready", () => {
    expect(linkCheckFor({ kind: "ready", url: "https://example.com/a", hostname: "example.com", scanned: true })).toEqual({
      status: "ready",
      url: "https://example.com/a",
      hostname: "example.com",
    });
  });

  it("never leaks the stored url for removed links", () => {
    expect(linkCheckFor({ kind: "removed", storedUrl: "https://bad.example" })).toEqual({ status: "removed" });
  });

  it("maps the remaining states", () => {
    expect(linkCheckFor({ kind: "unavailable" })).toEqual({ status: "unavailable" });
    expect(linkCheckFor({ kind: "none" })).toEqual({ status: "none" });
  });
});

describe("parseLinkCheck", () => {
  it("accepts a well-formed ready response", () => {
    expect(parseLinkCheck({ status: "ready", url: "https://example.com", hostname: "example.com" })).toMatchObject({ status: "ready" });
  });

  it("refuses non-http urls and junk", () => {
    expect(parseLinkCheck({ status: "ready", url: "javascript:alert(1)", hostname: "x" })).toEqual({ status: "unavailable" });
    expect(parseLinkCheck({ status: "ready" })).toEqual({ status: "unavailable" });
    expect(parseLinkCheck(null)).toEqual({ status: "unavailable" });
    expect(parseLinkCheck({ status: "removed" })).toEqual({ status: "removed" });
    expect(parseLinkCheck({ status: "none" })).toEqual({ status: "none" });
  });
});
