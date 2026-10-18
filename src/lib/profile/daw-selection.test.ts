import { describe, expect, it } from "vitest";
import { canSelectDaw, dawName, normalizeDaws, toggleDaw } from "./daw-selection";
import { DAWS, MAX_DAWS } from "./daws";

describe("daw selection", () => {
  it("appends in click order", () => {
    expect(toggleDaw([], "fl-studio")).toEqual(["fl-studio"]);
    expect(toggleDaw(["fl-studio"], "ableton-live")).toEqual(["fl-studio", "ableton-live"]);
  });

  it("removes a selected daw and keeps the rest in order", () => {
    expect(toggleDaw(["fl-studio", "ableton-live", "reaper"], "ableton-live")).toEqual(["fl-studio", "reaper"]);
  });

  it("ignores new picks once the max is reached", () => {
    const full = ["fl-studio", "ableton-live", "reaper"] as const;
    expect(MAX_DAWS).toBe(3);
    expect(toggleDaw(full, "cubase")).toEqual(full);
    expect(toggleDaw(["fl-studio"], "cubase", 1)).toEqual(["fl-studio"]);
  });

  it("does not mutate the input", () => {
    const selection = ["fl-studio" as const];
    toggleDaw(selection, "reaper");
    expect(selection).toEqual(["fl-studio"]);
  });

  it("reports which options stay selectable at the limit", () => {
    const full = ["fl-studio", "ableton-live", "reaper"] as const;
    expect(canSelectDaw(full, "reaper")).toBe(true);
    expect(canSelectDaw(full, "cubase")).toBe(false);
    expect(canSelectDaw(["fl-studio"], "cubase")).toBe(true);
  });

  it("normalizes stored values: drops unknown, dedupes, caps", () => {
    expect(normalizeDaws(["reaper", "nope", 4, "reaper", "lmms", "ardour", "mpc"])).toEqual(["reaper", "lmms", "ardour"]);
    expect(normalizeDaws(null)).toEqual([]);
    expect(normalizeDaws(undefined)).toEqual([]);
  });

  it("trims an over-limit selection before toggling", () => {
    expect(toggleDaw(["reaper", "lmms", "ardour", "mpc"], "cubase")).toEqual(["reaper", "lmms", "ardour"]);
    expect(toggleDaw(["reaper", "lmms", "ardour", "mpc"], "lmms")).toEqual(["reaper", "ardour"]);
  });

  it("names every daw", () => {
    for (const daw of DAWS) expect(dawName(daw.slug)).toBe(daw.name);
  });
});
