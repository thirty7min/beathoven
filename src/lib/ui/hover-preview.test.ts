import { describe, expect, it } from "vitest";
import { fadeVolume, initialPreviewState, isStaleAbort, previewProgress, previewReducer, previewTransition, type PreviewEvent, type PreviewState } from "./hover-preview";

const run = (events: PreviewEvent[], start: PreviewState = initialPreviewState) => events.reduce(previewReducer, start);

describe("previewReducer", () => {
  it("plays only after the hover intent fires", () => {
    expect(run([{ type: "enter", id: "a" }])).toMatchObject({ activeId: null, pendingId: "a" });
    expect(run([{ type: "enter", id: "a" }, { type: "intent", id: "a" }])).toMatchObject({ activeId: "a", pendingId: null });
  });

  it("ignores a stale intent after the pointer moved on", () => {
    expect(run([{ type: "enter", id: "a" }, { type: "leave", id: "a" }, { type: "intent", id: "a" }]).activeId).toBeNull();
    expect(run([{ type: "enter", id: "a" }, { type: "enter", id: "b" }, { type: "intent", id: "a" }]).activeId).toBeNull();
  });

  it("keeps one preview at a time and switches on the next card", () => {
    const playingA = run([{ type: "enter", id: "a" }, { type: "intent", id: "a" }]);
    expect(run([{ type: "enter", id: "b" }, { type: "intent", id: "b" }], playingA).activeId).toBe("b");
  });

  it("stops on leave only for the card that is playing", () => {
    const playingA = run([{ type: "enter", id: "a" }, { type: "intent", id: "a" }]);
    expect(previewReducer(playingA, { type: "leave", id: "a" }).activeId).toBeNull();
    expect(previewReducer(playingA, { type: "leave", id: "b" }).activeId).toBe("a");
  });

  it("toggles on tap for touch devices", () => {
    const tapped = previewReducer(initialPreviewState, { type: "tap", id: "a" });
    expect(tapped.activeId).toBe("a");
    expect(previewReducer(tapped, { type: "tap", id: "a" }).activeId).toBeNull();
    expect(previewReducer(tapped, { type: "tap", id: "b" }).activeId).toBe("b");
  });

  it("falls back to a visible play button when the browser blocks playback", () => {
    const playingA = run([{ type: "tap", id: "a" }]);
    const blocked = previewReducer(playingA, { type: "blocked", id: "a" });
    expect(blocked).toMatchObject({ activeId: null, blockedId: "a" });
    expect(previewReducer(blocked, { type: "tap", id: "a" })).toMatchObject({ activeId: "a", blockedId: null });
  });

  it("clears when the track ends", () => {
    expect(previewReducer(run([{ type: "tap", id: "a" }]), { type: "ended", id: "a" }).activeId).toBeNull();
  });
});

describe("previewTransition", () => {
  it("fades the old preview out before starting the next one", () => {
    expect(previewTransition(true, "b")).toBe("handoff");
    expect(previewTransition(false, "b")).toBe("start");
  });

  it("only fades out when something is audible", () => {
    expect(previewTransition(true, null)).toBe("stop");
    expect(previewTransition(false, null)).toBe("none");
  });
});

describe("isStaleAbort", () => {
  it("treats an interrupted play() as stale, not as blocked", () => {
    expect(isStaleAbort(new DOMException("interrupted", "AbortError"))).toBe(true);
    expect(isStaleAbort(new DOMException("no gesture", "NotAllowedError"))).toBe(false);
    expect(isStaleAbort(new Error("x"))).toBe(false);
  });
});

describe("fadeVolume", () => {
  it("ramps linearly and clamps at the end", () => {
    expect(fadeVolume(0, 1, 0, 100)).toBe(0);
    expect(fadeVolume(0, 1, 50, 100)).toBe(0.5);
    expect(fadeVolume(0.8, 0, 200, 100)).toBe(0);
    expect(fadeVolume(0, 1, 10, 0)).toBe(1);
  });
});

describe("previewProgress", () => {
  it("measures against the room's clip and stops there", () => {
    expect(previewProgress(15_000, 120_000, 30_000)).toEqual({ progress: 0.5, done: false });
    expect(previewProgress(30_000, 120_000, 30_000)).toEqual({ progress: 1, done: true });
  });

  it("uses the full track when it is shorter than the clip or no clip is set", () => {
    expect(previewProgress(10_000, 20_000, 45_000)).toEqual({ progress: 0.5, done: false });
    expect(previewProgress(10_000, 40_000, null)).toEqual({ progress: 0.25, done: false });
  });

  it("stays at zero before metadata loads", () => {
    expect(previewProgress(0, Number.NaN, null)).toEqual({ progress: 0, done: false });
  });
});
