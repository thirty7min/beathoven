import { describe, expect, it } from "vitest";
import { canvasFallback, cycleStyle, flowSpeed, measureBands, parsePrefs, smoothBands, smoothToward, vignetteGradient, type Bands } from "./visualizer";

describe("style cycling", () => {
  it("cycles both ways and wraps", () => {
    expect(cycleStyle("aurora", 1)).toBe("kaleido");
    expect(cycleStyle("kaleido", 1)).toBe("plasma");
    expect(cycleStyle("halftone", 1)).toBe("glow");
    expect(cycleStyle("tunnel", 1)).toBe("aurora");
    expect(cycleStyle("aurora", -1)).toBe("tunnel");
  });
});

describe("vignetteGradient", () => {
  it("builds the radial shade from the tunable values", () => {
    expect(vignetteGradient({ widthPct: 56, heightPct: 55, centerYPct: 54, inner: 0.65, middle: 0.325, outer: 0.05 })).toBe(
      "radial-gradient(ellipse 56% 55% at 50% 54%, rgba(10,10,10,0.65) 0%, rgba(10,10,10,0.325) 55%, rgba(10,10,10,0.05) 100%)",
    );
  });
});

describe("parsePrefs", () => {
  it("defaults to on with aurora, or off under reduced motion", () => {
    expect(parsePrefs(null, false)).toEqual({ on: true, style: "aurora" });
    expect(parsePrefs(null, true)).toEqual({ on: false, style: "aurora" });
  });

  it("restores saved values and drops retired or junk styles", () => {
    expect(parsePrefs(JSON.stringify({ on: false, style: "plasma" }), false)).toEqual({ on: false, style: "plasma" });
    expect(parsePrefs(JSON.stringify({ on: true, style: "halftone" }), false)).toEqual({ on: true, style: "halftone" });
    expect(parsePrefs(JSON.stringify({ on: true, style: "bars" }), false)).toEqual({ on: true, style: "aurora" });
    expect(parsePrefs("{", false)).toEqual({ on: true, style: "aurora" });
  });
});

describe("measureBands", () => {
  it("averages bass, mids and highs from the right bins", () => {
    const frequencies = new Uint8Array(1024);
    const binHz = 24_000 / 1024;
    for (let i = 0; i < 1024; i++) frequencies[i] = i * binHz < 250 ? 255 : i * binHz < 2000 ? 51 : 0;
    const bands = measureBands(frequencies, binHz, { bass: 0, mid: 0, high: 0 });
    expect(bands.bass).toBeGreaterThan(0.9);
    expect(bands.mid).toBeCloseTo(0.2, 1);
    expect(bands.high).toBeLessThan(0.01);
  });

  it("writes into the given object instead of allocating", () => {
    const out: Bands = { bass: 1, mid: 1, high: 1 };
    expect(measureBands(new Uint8Array(512), 46.875, out)).toBe(out);
    expect(out).toEqual({ bass: 0, mid: 0, high: 0 });
  });
});

describe("smoothing", () => {
  it("rises fast and falls slowly", () => {
    const up = smoothToward(0, 1, 50, 40, 300);
    const down = smoothToward(1, 0, 50, 40, 300);
    expect(up).toBeGreaterThan(0.7);
    expect(1 - down).toBeLessThan(0.2);
  });

  it("holds still without elapsed time and never overshoots", () => {
    expect(smoothToward(0.3, 1, 0, 40, 300)).toBe(0.3);
    expect(smoothToward(0, 1, 10_000, 40, 300)).toBeLessThanOrEqual(1);
  });

  it("smooths all bands in place", () => {
    const current: Bands = { bass: 0, mid: 0, high: 0 };
    smoothBands(current, { bass: 1, mid: 1, high: 1 }, 100);
    expect(current.bass).toBeGreaterThan(current.mid);
    expect(current.high).toBeGreaterThan(0);
  });
});

describe("flowSpeed", () => {
  it("speeds up with mids, and stays slow and steady under reduced motion", () => {
    expect(flowSpeed(1, false)).toBeGreaterThan(flowSpeed(0, false));
    expect(flowSpeed(1, true)).toBe(flowSpeed(0, true));
  });
});

describe("canvasFallback", () => {
  it("keeps WebGL when it works", () => {
    expect(canvasFallback("ready")).toBe("none");
  });

  it("reuses the canvas when WebGL never claimed it", () => {
    expect(canvasFallback("no-context")).toBe("same-canvas");
  });

  it("needs a fresh canvas when WebGL claimed it and the shader failed", () => {
    expect(canvasFallback("failed")).toBe("fresh-canvas");
  });
});
