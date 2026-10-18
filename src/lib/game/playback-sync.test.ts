import { describe, expect, it } from "vitest";
import type { Playback } from "./phase";
import { fadeGain, playbackProgress, seekPosition, syncAudio, type AudioStatus } from "./playback-sync";
import type { Submission } from "./types";

const submission: Submission = {
  id: "s1",
  user_id: "u1",
  storage_path: "r/1/u1/a.mp3",
  duration_ms: 60_000,
  submitted_at: "2026-01-01T00:00:00Z",
};

const audio = (over: Partial<AudioStatus> = {}): AudioStatus => ({
  paused: true,
  currentTimeMs: 0,
  seeking: false,
  ready: true,
  buffering: false,
  msSinceSeek: null,
  msSinceStall: null,
  ...over,
});

const playing = (offsetMs: number, clipMs = submission.duration_ms): Playback => ({ state: "playing", submission, clipStartMs: 0, clipMs, offsetMs });

describe("syncAudio", () => {
  it("pauses when nothing should play", () => {
    expect(syncAudio({ state: "idle" }, audio({ paused: false }))).toEqual({ type: "pause", seekToMs: null });
    expect(syncAudio({ state: "ended", submission, clipStartMs: 0, clipMs: 60_000 }, audio({ paused: false }))).toEqual({ type: "pause", seekToMs: null });
    expect(syncAudio({ state: "idle" }, audio())).toEqual({ type: "none" });
  });

  it("holds at the start during the lead-in", () => {
    const pending: Playback = { state: "pending", submission, clipStartMs: 0, clipMs: 60_000, startsInMs: 2000 };
    expect(syncAudio(pending, audio())).toEqual({ type: "none" });
    expect(syncAudio(pending, audio({ currentTimeMs: 500 }))).toEqual({ type: "pause", seekToMs: 0 });
    expect(syncAudio(pending, audio({ paused: false }))).toEqual({ type: "pause", seekToMs: null });
  });

  it("starts playback at the shared offset when joining late", () => {
    expect(syncAudio(playing(42_000), audio())).toEqual({ type: "play", seekToMs: 42_000 });
  });

  it("starts without seeking when already close enough", () => {
    expect(syncAudio(playing(120), audio())).toEqual({ type: "play", seekToMs: null });
  });

  it("corrects drift beyond the tolerance only", () => {
    expect(syncAudio(playing(10_000), audio({ paused: false, currentTimeMs: 10_200 }))).toEqual({ type: "none" });
    expect(syncAudio(playing(10_000), audio({ paused: false, currentTimeMs: 11_000 }))).toEqual({
      type: "play",
      seekToMs: 10_000,
    });
  });

  it("waits for metadata and in-flight seeks", () => {
    expect(syncAudio(playing(5000), audio({ ready: false }))).toEqual({ type: "none" });
    expect(syncAudio(playing(5000), audio({ seeking: true }))).toEqual({ type: "none" });
  });

  it("lets a stalled element buffer instead of re-seeking", () => {
    expect(syncAudio(playing(10_000), audio({ paused: false, currentTimeMs: 8_000, buffering: true }))).toEqual({ type: "none" });
  });

  it("still seeks a paused element that only has metadata, so late joiners start at the right spot", () => {
    expect(syncAudio(playing(42_000), audio({ buffering: true }))).toEqual({ type: "play", seekToMs: 42_000 });
  });

  it("backs off repeated seeks", () => {
    const drifted = { paused: false, currentTimeMs: 8_000 };
    expect(syncAudio(playing(10_000), audio({ ...drifted, msSinceSeek: 500 }))).toEqual({ type: "none" });
    expect(syncAudio(playing(10_000), audio({ ...drifted, msSinceSeek: 2_500 }))).toEqual({ type: "play", seekToMs: 10_000 });
    expect(syncAudio(playing(42_000), audio({ msSinceSeek: 500 }))).toEqual({ type: "play", seekToMs: null });
  });

  it("tolerates more drift right after a stall", () => {
    const behind = audio({ paused: false, currentTimeMs: 9_000 });
    expect(syncAudio(playing(10_000), { ...behind, msSinceStall: 3_000 })).toEqual({ type: "none" });
    expect(syncAudio(playing(10_000), { ...behind, msSinceStall: 12_000 })).toEqual({ type: "play", seekToMs: 10_000 });
    expect(syncAudio(playing(12_000), { ...behind, msSinceStall: 3_000 })).toEqual({ type: "play", seekToMs: 12_000 });
  });

  it("treats the listen limit as the end of the track", () => {
    expect(syncAudio(playing(44_900, 45_000), audio())).toEqual({ type: "none" });
  });

  it("does not restart a track in its last moments", () => {
    expect(syncAudio(playing(59_900), audio())).toEqual({ type: "none" });
    expect(syncAudio(playing(59_900), audio({ paused: false, currentTimeMs: 58_000 }))).toEqual({ type: "none" });
  });
});

describe("fadeGain", () => {
  it("fades a clipped track out over its last 300ms", () => {
    expect(fadeGain(playing(40_000, 45_000))).toBe(1);
    expect(fadeGain(playing(44_850, 45_000))).toBeCloseTo(0.5);
    expect(fadeGain(playing(45_000, 45_000))).toBe(0);
  });

  it("leaves full-length playback alone", () => {
    expect(fadeGain(playing(59_900))).toBe(1);
    expect(fadeGain({ state: "idle" })).toBe(1);
  });
});

describe("playbackProgress", () => {
  it("reports fraction played", () => {
    expect(playbackProgress({ state: "idle" })).toBe(0);
    expect(playbackProgress({ state: "pending", submission, clipStartMs: 0, clipMs: 60_000, startsInMs: 10 })).toBe(0);
    expect(playbackProgress(playing(30_000))).toBe(0.5);
    expect(playbackProgress(playing(15_000, 30_000))).toBe(0.5);
    expect(playbackProgress({ state: "ended", submission, clipStartMs: 0, clipMs: 60_000 })).toBe(1);
  });
});

describe("seekPosition", () => {
  it("maps a click to a point inside the clip", () => {
    expect(seekPosition(0.5, 30_000)).toBe(15_000);
    expect(seekPosition(-1, 30_000)).toBe(0);
    expect(seekPosition(2, 30_000)).toBe(30_000);
    expect(seekPosition(Number.NaN, 30_000)).toBe(0);
  });
});

describe("clip offsets", () => {
  const clipped = (state: "pending" | "playing", offsetMs = 0): Playback =>
    state === "pending"
      ? { state, submission, clipStartMs: 20_000, clipMs: 15_000, startsInMs: 1000 }
      : { state, submission, clipStartMs: 20_000, clipMs: 15_000, offsetMs };

  it("cues the clip start during the lead-in", () => {
    expect(syncAudio(clipped("pending"), audio())).toEqual({ type: "pause", seekToMs: 20_000 });
    expect(syncAudio(clipped("pending"), audio({ currentTimeMs: 20_000 }))).toEqual({ type: "none" });
  });

  it("syncs to the clip start plus the elapsed offset", () => {
    expect(syncAudio(clipped("playing", 5_000), audio({ currentTimeMs: 20_000 }))).toEqual({ type: "play", seekToMs: 25_000 });
    expect(syncAudio(clipped("playing", 5_000), audio({ currentTimeMs: 25_100 }))).toEqual({ type: "play", seekToMs: null });
    expect(syncAudio(clipped("playing", 14_900), audio({ currentTimeMs: 20_000 }))).toEqual({ type: "none" });
  });

  it("fades out at the clip end unless the clip reaches the end of the track", () => {
    expect(fadeGain(clipped("playing", 14_850))).toBeCloseTo(0.5);
    const tail: Playback = { state: "playing", submission, clipStartMs: 45_000, clipMs: 15_000, offsetMs: 14_900 };
    expect(fadeGain(tail)).toBe(1);
  });

  it("maps a waveform click inside the clip", () => {
    expect(seekPosition(0.5, 15_000, 20_000)).toBe(27_500);
    expect(seekPosition(Number.NaN, 15_000, 20_000)).toBe(20_000);
  });
});
