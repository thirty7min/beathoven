import { describe, expect, it } from "vitest";
import { clipLimits, initialClip, keyStep, moveEnd, moveStart, msAtFraction, classifyGesture, normalizeClip, playbackStopMs, previewShouldStop, sameClip, shiftClip, submissionStatus, trimmerHit } from "./clip-window";

const limits = clipLimits(180_000, 60);

describe("clipLimits", () => {
  it("caps the window at the room listen time and keeps a 10s minimum", () => {
    expect(limits).toEqual({ durationMs: 180_000, minMs: 10_000, maxMs: 60_000 });
    expect(clipLimits(45_000, 60)).toEqual({ durationMs: 45_000, minMs: 10_000, maxMs: 45_000 });
    expect(clipLimits(6_000, 60)).toEqual({ durationMs: 6_000, minMs: 6_000, maxMs: 6_000 });
    expect(clipLimits(90_000, null)).toEqual({ durationMs: 90_000, minMs: 10_000, maxMs: 90_000 });
  });
});

describe("initialClip", () => {
  it("starts at the top with the longest allowed window", () => {
    expect(initialClip(limits)).toEqual({ startMs: 0, endMs: 60_000 });
  });

  it("restores a saved window, fixed up to the limits", () => {
    expect(initialClip(limits, { startMs: 30_000, endMs: 70_000 })).toEqual({ startMs: 30_000, endMs: 70_000 });
    expect(initialClip(limits, { startMs: 150_000, endMs: 240_000 })).toEqual({ startMs: 120_000, endMs: 180_000 });
  });
});

describe("handles", () => {
  it("moves the start without breaking the min or max length", () => {
    const clip = { startMs: 20_000, endMs: 60_000 };
    expect(moveStart(clip, 55_000, limits)).toEqual({ startMs: 50_000, endMs: 60_000 });
    expect(moveStart(clip, -5_000, limits)).toEqual({ startMs: 0, endMs: 60_000 });
    expect(moveStart({ startMs: 100_000, endMs: 150_000 }, 10_000, limits)).toEqual({ startMs: 90_000, endMs: 150_000 });
  });

  it("moves the end within the track and the cap", () => {
    const clip = { startMs: 20_000, endMs: 60_000 };
    expect(moveEnd(clip, 200_000, limits)).toEqual({ startMs: 20_000, endMs: 80_000 });
    expect(moveEnd(clip, 0, limits)).toEqual({ startMs: 20_000, endMs: 30_000 });
    expect(moveEnd({ startMs: 150_000, endMs: 170_000 }, 400_000, limits)).toEqual({ startMs: 150_000, endMs: 180_000 });
  });

  it("drags the whole window and stops at the edges", () => {
    const clip = { startMs: 20_000, endMs: 60_000 };
    expect(shiftClip(clip, 30_000, limits)).toEqual({ startMs: 50_000, endMs: 90_000 });
    expect(shiftClip(clip, -60_000, limits)).toEqual({ startMs: 0, endMs: 40_000 });
    expect(shiftClip(clip, 500_000, limits)).toEqual({ startMs: 140_000, endMs: 180_000 });
  });

  it("normalizes odd windows", () => {
    expect(normalizeClip({ startMs: 10_000, endMs: 12_000 }, limits)).toEqual({ startMs: 10_000, endMs: 20_000 });
    expect(normalizeClip({ startMs: -5_000, endMs: 100_000 }, limits)).toEqual({ startMs: 0, endMs: 60_000 });
  });
});

describe("keyboard and pointer helpers", () => {
  it("steps 1s with arrows and 5s with shift", () => {
    expect(keyStep("ArrowRight", false)).toBe(1_000);
    expect(keyStep("ArrowLeft", true)).toBe(-5_000);
    expect(keyStep("Enter", false)).toBeNull();
  });

  it("maps a pointer fraction onto the track", () => {
    expect(msAtFraction(0.5, 180_000)).toBe(90_000);
    expect(msAtFraction(-1, 180_000)).toBe(0);
    expect(msAtFraction(Number.NaN, 180_000)).toBe(0);
  });

  it("compares windows", () => {
    expect(sameClip({ startMs: 1, endMs: 2 }, { startMs: 1, endMs: 2 })).toBe(true);
    expect(sameClip({ startMs: 1, endMs: 2 }, null)).toBe(false);
  });
});

describe("submissionStatus", () => {
  it("stays a draft until confirmed, then tracks unsaved edits, and locks at the deadline", () => {
    expect(submissionStatus({ confirmed: false, dirty: true, closed: false })).toBe("draft");
    expect(submissionStatus({ confirmed: true, dirty: false, closed: false })).toBe("submitted");
    expect(submissionStatus({ confirmed: true, dirty: true, closed: false })).toBe("edited");
    expect(submissionStatus({ confirmed: false, dirty: false, closed: true })).toBe("locked");
  });
});

describe("previewShouldStop", () => {
  it("plays inside the selection and stops at its end, in milliseconds", () => {
    const clip = { startMs: 30_000, endMs: 60_000 };
    expect(previewShouldStop(30_000, clip)).toBe(false);
    expect(previewShouldStop(59_999, clip)).toBe(false);
    expect(previewShouldStop(60_000, clip)).toBe(true);
    expect(previewShouldStop(29_900, clip)).toBe(false);
    expect(previewShouldStop(10_000, clip)).toBe(true);
  });
});

describe("trimmerHit", () => {
  const clip = { startMs: 30_000, endMs: 90_000 };
  const width = 600;

  it("grabs the nearest edge handle within its hit zone", () => {
    expect(trimmerHit(100, width, clip, 180_000, true)).toBe("start");
    expect(trimmerHit(110, width, clip, 180_000, true)).toBe("start");
    expect(trimmerHit(296, width, clip, 180_000, true)).toBe("end");
  });

  it("tells the selection apart from the rest of the track", () => {
    expect(trimmerHit(200, width, clip, 180_000, true)).toBe("window");
    expect(trimmerHit(450, width, clip, 180_000, true)).toBe("outside");
    expect(trimmerHit(20, width, clip, 180_000, true)).toBe("outside");
  });

  it("treats everything as track when the clip is locked", () => {
    expect(trimmerHit(100, width, clip, 180_000, false)).toBe("outside");
    expect(trimmerHit(200, width, clip, 180_000, false)).toBe("outside");
  });
});

describe("classifyGesture", () => {
  const base = { distancePx: 0, elapsedMs: 100, pointerType: "mouse", released: false };

  it("resizes straight away from a handle", () => {
    expect(classifyGesture({ ...base, hit: "start" })).toBe("resize");
    expect(classifyGesture({ ...base, hit: "end", released: true })).toBe("resize");
  });

  it("waits until the pointer moves or lifts", () => {
    expect(classifyGesture({ ...base, hit: "window" })).toBe("pending");
    expect(classifyGesture({ ...base, hit: "window", distancePx: 4 })).toBe("pending");
  });

  it("moves the window or scrubs once past the mouse slop", () => {
    expect(classifyGesture({ ...base, hit: "window", distancePx: 5 })).toBe("move");
    expect(classifyGesture({ ...base, hit: "outside", distancePx: 5 })).toBe("scrub");
  });

  it("uses a larger slop for touch", () => {
    expect(classifyGesture({ ...base, hit: "window", distancePx: 7, pointerType: "touch" })).toBe("pending");
    expect(classifyGesture({ ...base, hit: "window", distancePx: 9, pointerType: "touch" })).toBe("move");
  });

  it("seeks on a quick click anywhere and ignores a long still press", () => {
    expect(classifyGesture({ ...base, hit: "window", released: true })).toBe("seek");
    expect(classifyGesture({ ...base, hit: "outside", distancePx: 3, released: true })).toBe("seek");
    expect(classifyGesture({ ...base, hit: "window", elapsedMs: 600, released: true })).toBe("ignore");
  });
});

describe("playbackStopMs", () => {
  const clip = { startMs: 30_000, endMs: 90_000 };

  it("stops a preview at the selection end", () => {
    expect(playbackStopMs("selection", 30_000, clip, 180_000)).toBe(90_000);
  });

  it("plays to the selection end from inside it, and to the track end from outside", () => {
    expect(playbackStopMs("free", 45_000, clip, 180_000)).toBe(90_000);
    expect(playbackStopMs("free", 10_000, clip, 180_000)).toBe(180_000);
    expect(playbackStopMs("free", 90_000, clip, 180_000)).toBe(180_000);
  });
});
