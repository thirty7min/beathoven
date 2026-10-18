import { describe, expect, it } from "vitest";
import { phaseLabel, submitPhaseCopy } from "./phase-label";

describe("phaseLabel", () => {
  it("calls a premade round uploading, never producing", () => {
    expect(phaseLabel("premade", "producing")).toBe("Uploading");
    expect(phaseLabel("classic", "producing")).toBe("Producing");
    expect(phaseLabel("creative", "producing")).toBe("Producing");
  });

  it("names the shared phases the same for every mode", () => {
    for (const mode of ["classic", "premade", "creative"] as const) {
      expect(phaseLabel(mode, "lobby")).toBe("Lobby");
      expect(phaseLabel(mode, "listening")).toBe("Listening");
      expect(phaseLabel(mode, "results")).toBe("Results");
      expect(phaseLabel(mode, "closed")).toBeNull();
    }
  });
});

describe("submitPhaseCopy", () => {
  it("has no production wording for premade", () => {
    const copy = submitPhaseCopy("premade");
    expect(copy.title).toBe("Upload");
    expect(Object.values(copy).join(" ")).not.toMatch(/produc/i);
  });

  it("keeps production wording for classic and creative", () => {
    expect(submitPhaseCopy("classic").title).toBe("Producing");
    expect(submitPhaseCopy("creative").countdown).toBe("Time left to produce");
  });
});
