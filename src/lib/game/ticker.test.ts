import { afterEach, describe, expect, it, vi } from "vitest";
import { startTicker } from "./ticker";

afterEach(() => {
  vi.useRealTimers();
});

describe("startTicker", () => {
  it("falls back to an interval without workers and stops cleanly", () => {
    vi.useFakeTimers();
    const onTick = vi.fn();
    const stop = startTicker(10_000, onTick);
    vi.advanceTimersByTime(30_000);
    expect(onTick).toHaveBeenCalledTimes(3);
    stop();
    vi.advanceTimersByTime(30_000);
    expect(onTick).toHaveBeenCalledTimes(3);
  });
});
