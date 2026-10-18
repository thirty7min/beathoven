import { describe, expect, it } from "vitest";
import { initialRevealState, isRevealed, revealReducer, type RevealEvent, type RevealState } from "./volume-reveal";

const run = (events: RevealEvent["type"][], start: RevealState = initialRevealState) =>
  events.reduce((state, type) => revealReducer(state, { type } as RevealEvent), start);

describe("revealReducer", () => {
  it("opens on hover and closes when the pointer leaves", () => {
    expect(isRevealed(run(["hover"]))).toBe(true);
    expect(isRevealed(run(["hover", "hoverEnd"]))).toBe(false);
  });

  it("stays open through a drag that leaves, then closes when it ends", () => {
    expect(isRevealed(run(["hover", "dragStart", "hoverEnd"]))).toBe(true);
    expect(isRevealed(run(["hover", "dragStart", "hoverEnd", "dragEnd"]))).toBe(false);
    expect(isRevealed(run(["hover", "dragStart", "dragEnd"]))).toBe(true);
  });

  it("only keeps keyboard focus open, mouse focus is not tracked", () => {
    expect(isRevealed(run(["keyboardFocus"]))).toBe(true);
    expect(isRevealed(run(["keyboardFocus", "blur"]))).toBe(false);
    expect(isRevealed(run(["keyboardFocus", "hover", "hoverEnd"]))).toBe(true);
  });

  it("closes a touch reveal on outside tap or idle, but not mid-drag", () => {
    expect(isRevealed(run(["touchOpen", "outside"]))).toBe(false);
    expect(isRevealed(run(["touchOpen", "idle"]))).toBe(false);
    expect(isRevealed(run(["touchOpen", "dragStart", "idle"]))).toBe(true);
  });
});
