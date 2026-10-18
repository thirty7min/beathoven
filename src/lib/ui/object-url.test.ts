import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { objectUrlFor, releaseObjectUrl, retainObjectUrl } from "./object-url";

describe("object urls", () => {
  let count = 0;
  const revoke = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    revoke.mockReset();
    vi.stubGlobal("URL", { createObjectURL: () => `blob:${++count}`, revokeObjectURL: revoke });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reuses one url per blob", () => {
    const blob = new Blob(["a"]);
    expect(objectUrlFor(blob)).toBe(objectUrlFor(blob));
  });

  it("survives a release that is immediately followed by a retain, like a strict-mode remount", () => {
    const blob = new Blob(["b"]);
    const url = objectUrlFor(blob);
    releaseObjectUrl(blob, url);
    retainObjectUrl(url);
    vi.advanceTimersByTime(5_000);
    expect(revoke).not.toHaveBeenCalled();
    expect(objectUrlFor(blob)).toBe(url);
  });

  it("revokes after a real release and hands out a fresh url next time", () => {
    const blob = new Blob(["c"]);
    const url = objectUrlFor(blob);
    releaseObjectUrl(blob, url);
    vi.advanceTimersByTime(1_000);
    expect(revoke).toHaveBeenCalledWith(url);
    expect(objectUrlFor(blob)).not.toBe(url);
  });
});
