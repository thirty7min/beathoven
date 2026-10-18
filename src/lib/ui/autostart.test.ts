import { describe, expect, it } from "vitest";
import { AUTOSTART_SECONDS } from "@/lib/game/phase";
import { autostartView } from "./autostart";

describe("autostartView", () => {
  it("is hidden without a countdown", () => {
    expect(autostartView(null)).toBeNull();
  });

  it("counts whole seconds down to one", () => {
    expect(autostartView(5000)).toEqual({ seconds: 5, fraction: 1 });
    expect(autostartView(4001)?.seconds).toBe(5);
    expect(autostartView(4000)?.seconds).toBe(4);
    expect(autostartView(10)?.seconds).toBe(1);
    expect(autostartView(0)).toEqual({ seconds: 1, fraction: 0 });
  });

  it("caps a far-off or skewed start at the full countdown", () => {
    expect(autostartView(60_000)).toEqual({ seconds: AUTOSTART_SECONDS, fraction: 1 });
    expect(autostartView(-500)?.fraction).toBe(0);
  });
});
