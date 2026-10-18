import { describe, expect, it } from "vitest";
import {
  UPLOAD_GRACE_MS,
  advanceDueAt,
  cappedRemaining,
  clipMs,
  formatCountdown,
  needsSeek,
  phaseCountdown,
  playbackPosition,
  remainingMs,
} from "./phase";
import { formatClock } from "./format";
import type { Room, Submission } from "./types";

const T0 = Date.parse("2026-10-18T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

const submission: Submission = {
  id: "s1",
  user_id: "u1",
  storage_path: "r/1/u1/1.mp3",
  duration_ms: 60_000,
  submitted_at: iso(T0),
};

function room(overrides: Partial<Room>): Room {
  return {
    id: "r",
    code: "ABC234",
    host_id: "u1",
    mode: "creative",
    max_players: 8,
    produce_seconds: 600,
    vote_seconds: 20,
    is_private: false,
    status: "lobby",
    round: 1,
    phase_started_at: iso(T0),
    phase_ends_at: null,
    track_order: [],
    current_track: null,
    track_started_at: null,
    ...overrides,
  };
}

describe("remainingMs", () => {
  it("clamps at zero and passes null through", () => {
    expect(remainingMs(T0 + 1500, T0)).toBe(1500);
    expect(remainingMs(T0, T0 + 10)).toBe(0);
    expect(remainingMs(null, T0)).toBeNull();
  });
});

describe("phaseCountdown", () => {
  it("has no countdown in the lobby", () => {
    expect(phaseCountdown(room({}), [], T0)).toBeNull();
  });

  it("splits producing into produce time then upload grace", () => {
    const r = room({ status: "producing", phase_ends_at: iso(T0 + 600_000 + UPLOAD_GRACE_MS) });
    expect(phaseCountdown(r, [], T0)).toEqual({ label: "produce", endsAt: T0 + 600_000, remainingMs: 600_000 });
    expect(phaseCountdown(r, [], T0 + 605_000)).toMatchObject({ label: "upload", remainingMs: 10_000 });
  });

  it("walks a listening slot through the lead-in and the track, with no vote window after", () => {
    const r = room({
      status: "listening",
      track_order: ["s1"],
      current_track: 0,
      track_started_at: iso(T0 + 3000),
      phase_ends_at: iso(T0 + 3000 + 60_000 + 20_000),
    });
    expect(phaseCountdown(r, [submission], T0)).toMatchObject({ label: "starting", remainingMs: 3000 });
    expect(phaseCountdown(r, [submission], T0 + 33_000)).toMatchObject({ label: "track", remainingMs: 30_000 });
    expect(phaseCountdown(r, [submission], T0 + 73_000)).toMatchObject({ label: "track", remainingMs: 0 });
  });

  it("ends the track countdown at the listen limit", () => {
    const r = {
      ...room({
        status: "listening",
        track_order: ["s1"],
        current_track: 0,
        track_started_at: iso(T0),
        phase_ends_at: iso(T0 + 30_000 + 20_000),
      }),
      listen_seconds: 30,
    };
    expect(phaseCountdown(r, [submission], T0 + 10_000)).toMatchObject({ label: "track", remainingMs: 20_000 });
    expect(phaseCountdown(r, [submission], T0 + 31_000)).toMatchObject({ label: "track", remainingMs: 0 });
  });

  it("counts down results", () => {
    expect(phaseCountdown(room({ status: "results", phase_ends_at: iso(T0 + 30_000) }), [], T0)).toMatchObject({
      label: "results",
      remainingMs: 30_000,
    });
  });
});

describe("playbackPosition", () => {
  const r = room({ status: "listening", track_order: ["s1"], current_track: 0, track_started_at: iso(T0) });

  it("reports pending, playing at offset, then ended", () => {
    expect(playbackPosition(r, [submission], T0 - 2500)).toEqual({ state: "pending", submission, clipMs: 60_000, startsInMs: 2500 });
    expect(playbackPosition(r, [submission], T0 + 12_345)).toEqual({ state: "playing", submission, clipMs: 60_000, offsetMs: 12_345 });
    expect(playbackPosition(r, [submission], T0 + 60_000)).toEqual({ state: "ended", submission, clipMs: 60_000 });
  });

  it("ends at the room's listen limit", () => {
    const limited = { ...r, listen_seconds: 45 };
    expect(playbackPosition(limited, [submission], T0 + 44_000)).toMatchObject({ state: "playing", clipMs: 45_000 });
    expect(playbackPosition(limited, [submission], T0 + 45_000)).toEqual({ state: "ended", submission, clipMs: 45_000 });
  });

  it("is idle outside listening or when the submission is unknown", () => {
    expect(playbackPosition(room({}), [submission], T0)).toEqual({ state: "idle" });
    expect(playbackPosition(r, [], T0)).toEqual({ state: "idle" });
  });
});

describe("clipMs", () => {
  it("caps the track at the listen limit", () => {
    expect(clipMs(45, submission)).toBe(45_000);
    expect(clipMs(45, { duration_ms: 20_000 })).toBe(20_000);
  });

  it("plays the whole track when the room has no limit", () => {
    expect(clipMs(undefined, submission)).toBe(60_000);
    expect(clipMs(null, submission)).toBe(60_000);
  });
});

describe("advanceDueAt", () => {
  it("is the phase deadline for timed phases only", () => {
    expect(advanceDueAt(room({ status: "producing", phase_ends_at: iso(T0) }))).toBe(T0);
    expect(advanceDueAt(room({ status: "lobby" }))).toBeNull();
    expect(advanceDueAt(room({ status: "closed", phase_ends_at: iso(T0) }))).toBeNull();
  });
});

describe("helpers", () => {
  it("formats countdowns rounding up to whole seconds", () => {
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(1)).toBe("0:01");
    expect(formatCountdown(61_000)).toBe("1:01");
    expect(formatCountdown(-5)).toBe("0:00");
  });

  it("seeks only beyond tolerance", () => {
    expect(needsSeek(10_000, 10_200)).toBe(false);
    expect(needsSeek(10_000, 10_500)).toBe(true);
  });
});

describe("countdown cap", () => {
  it("never shows more than the configured produce time when the client clock trails the server", () => {
    const r = room({ status: "producing", produce_seconds: 180, phase_ends_at: iso(T0 + 180_000 + UPLOAD_GRACE_MS) });
    const early = phaseCountdown(r, [], T0 - 400);
    expect(early).toMatchObject({ label: "produce", remainingMs: 180_000 });
    expect(formatClock(early!.remainingMs)).toBe("3:00");
    expect(formatClock(phaseCountdown(r, [], T0 + 1)!.remainingMs)).toBe("3:00");
    expect(formatClock(phaseCountdown(r, [], T0 + 1000)!.remainingMs)).toBe("2:59");
  });

  it("keeps the upload grace invisible and bounded", () => {
    const r = room({ status: "producing", produce_seconds: 180, phase_ends_at: iso(T0 + 180_000 + UPLOAD_GRACE_MS) });
    expect(phaseCountdown(r, [], T0 + 180_000)).toMatchObject({ label: "upload", remainingMs: UPLOAD_GRACE_MS });
  });

  it("clamps between zero and the cap", () => {
    expect(cappedRemaining(T0 + 5000, T0, 3000)).toBe(3000);
    expect(cappedRemaining(T0, T0 + 10)).toBe(0);
    expect(cappedRemaining(T0 + 2000, T0)).toBe(2000);
  });
});
