import { describe, expect, it } from "vitest";
import { siteUrl } from "./site-url";

describe("siteUrl", () => {
  it("prefers the configured site URL", () => {
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "https://beathoven.io", VERCEL_ENV: "production", VERCEL_URL: "x.vercel.app" }).href).toBe(
      "https://beathoven.io/",
    );
  });

  it("uses the production domain on production deployments", () => {
    expect(siteUrl({ VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "beathoven.io", VERCEL_URL: "x.vercel.app" }).origin).toBe(
      "https://beathoven.io",
    );
  });

  it("uses the deployment URL on previews", () => {
    expect(siteUrl({ VERCEL_ENV: "preview", VERCEL_PROJECT_PRODUCTION_URL: "beathoven.io", VERCEL_URL: "x.vercel.app" }).origin).toBe(
      "https://x.vercel.app",
    );
  });

  it("falls back to localhost off Vercel", () => {
    expect(siteUrl({}).origin).toBe("http://localhost:3000");
  });
});
