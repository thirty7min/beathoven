import { describe, expect, it, vi } from "vitest";
import { getTrackStreamUrl } from "./api";

const reply = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("getTrackStreamUrl", () => {
  it("returns the signed url from the stream route", async () => {
    const fetcher = reply(200, {
      url: "https://x/signed",
      expiresAt: "2026-10-18T00:05:00Z",
      loudnessLufs: -20.5,
      truePeakDbtp: -3,
      loudnessBoost: true,
    });
    expect(await getTrackStreamUrl("t-1", fetcher)).toEqual({
      url: "https://x/signed",
      expiresAt: "2026-10-18T00:05:00Z",
      loudnessLufs: -20.5,
      truePeakDbtp: -3,
      loudnessBoost: true,
    });
    expect(fetcher).toHaveBeenCalledWith("/api/tracks/t-1/stream", { cache: "no-store" });
  });

  it("maps route errors to game errors", async () => {
    await expect(getTrackStreamUrl("t", reply(403, { error: "track_not_playable" }))).rejects.toMatchObject({ code: "track_not_playable" });
    await expect(getTrackStreamUrl("t", reply(429, { error: "stream_rate_limited" }))).rejects.toMatchObject({ code: "stream_rate_limited" });
    await expect(getTrackStreamUrl("t", reply(500, null))).rejects.toMatchObject({ code: "unknown" });
  });
});
