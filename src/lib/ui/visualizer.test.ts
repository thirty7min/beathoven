import { describe, expect, it } from "vitest";
import { ANALYSER_FFT_SIZE } from "./audio-graph";
import {
  BAND_EDGES_HZ,
  BEAT_GAIN,
  bandBins,
  blendMix,
  canvasFallback,
  cycleStyle,
  easeInOutCubic,
  flowSpeed,
  isSilentSpectrum,
  measureBands,
  parsePrefs,
  reactiveLevels,
  smoothBands,
  smoothToward,
  vignetteGradient,
  type Bands,
} from "./visualizer";

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

describe("reactiveLevels", () => {
  it("scales only the beat over the original mapping", () => {
    const levels = reactiveLevels({ bass: 0.5, mid: 0.4, high: 0.3 }, false, { pulse: 0, mid: 0, shimmer: 0 });
    expect(levels.pulse).toBeCloseTo(0.5 * BEAT_GAIN);
    expect(levels.mid).toBe(0.4);
    expect(levels.shimmer).toBe(0.3);
  });

  it("stays still under reduced motion", () => {
    expect(reactiveLevels({ bass: 1, mid: 1, high: 1 }, true, { pulse: 1, mid: 1, shimmer: 1 })).toEqual({ pulse: 0, mid: 0, shimmer: 0 });
  });

  it("pulses from a spectrum with strong low bins", () => {
    const binHz = 48_000 / 2048;
    const spectrum = new Uint8Array(1024).fill(40);
    for (let i = 1; i < 11; i++) spectrum[i] = 235;
    let bands: Bands = { bass: 0, mid: 0, high: 0 };
    const target = measureBands(spectrum, binHz, { bass: 0, mid: 0, high: 0 });
    for (let i = 0; i < 6; i++) bands = smoothBands(bands, target, 16);
    const levels = reactiveLevels(bands, false, { pulse: 0, mid: 0, shimmer: 0 });
    expect(levels.pulse).toBeGreaterThan(0.5);
    expect(levels.pulse).toBeGreaterThan(levels.mid * 2);
  });
});

describe("bandBins", () => {
  const fftSize = ANALYSER_FFT_SIZE;
  const bins = fftSize / 2;

  it.each([44_100, 48_000])("keeps the bass band under 260 Hz at %i Hz", (sampleRate) => {
    const binHz = sampleRate / fftSize;
    const [bassStart, bassEnd] = bandBins(binHz, BAND_EDGES_HZ.bass[0], BAND_EDGES_HZ.bass[1], bins);
    expect(bassStart * binHz).toBeLessThanOrEqual(BAND_EDGES_HZ.bass[0]);
    expect((bassEnd - 1) * binHz).toBeLessThan(260);
    expect(bassEnd - bassStart).toBeGreaterThanOrEqual(10);
  });

  it("matches the exact bins at 48 kHz", () => {
    expect(bandBins(48_000 / 2048, 20, 250, 1024)).toEqual([0, 11]);
    expect(bandBins(44_100 / 2048, 20, 250, 1024)).toEqual([0, 12]);
  });
});

describe("isSilentSpectrum", () => {
  it("spots an all-zero spectrum", () => {
    expect(isSilentSpectrum(new Uint8Array(8))).toBe(true);
    expect(isSilentSpectrum(Uint8Array.from([0, 0, 3]))).toBe(false);
  });
});

describe("parsePrefs", () => {
  it("defaults to off with aurora when nothing is saved", () => {
    expect(parsePrefs(null)).toEqual({ on: false, style: "aurora" });
  });

  it("restores saved values and drops retired or junk styles", () => {
    expect(parsePrefs(JSON.stringify({ on: false, style: "plasma" }))).toEqual({ on: false, style: "plasma" });
    expect(parsePrefs(JSON.stringify({ on: true, style: "halftone" }))).toEqual({ on: true, style: "halftone" });
    expect(parsePrefs(JSON.stringify({ on: true, style: "bars" }))).toEqual({ on: true, style: "aurora" });
    expect(parsePrefs(JSON.stringify({ style: "tunnel" }))).toEqual({ on: false, style: "tunnel" });
    expect(parsePrefs("{")).toEqual({ on: false, style: "aurora" });
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

describe("style blend timing", () => {
  it("eases in and out symmetrically and clamps", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(0.5)).toBe(0.5);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.25)).toBeCloseTo(1 - easeInOutCubic(0.75));
    expect(easeInOutCubic(-1)).toBe(0);
    expect(easeInOutCubic(2)).toBe(1);
  });

  it("maps elapsed time onto the blend and finishes instantly with no duration", () => {
    expect(blendMix(0, 800)).toBe(0);
    expect(blendMix(400, 800)).toBe(0.5);
    expect(blendMix(1200, 800)).toBe(1);
    expect(blendMix(10, 0)).toBe(1);
  });
});
