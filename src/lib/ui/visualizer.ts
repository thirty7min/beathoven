export const VISUALIZER_STYLES = ["aurora", "kaleido", "plasma", "halftone", "glow", "tunnel"] as const;
export type VisualizerStyle = (typeof VISUALIZER_STYLES)[number];
export type VisualizerPrefs = { on: boolean; style: VisualizerStyle };
export type Bands = { bass: number; mid: number; high: number };

export const STYLE_LABELS: Record<VisualizerStyle, string> = {
  aurora: "Aurora",
  plasma: "Plasma",
  glow: "Glow",
  kaleido: "Kaleido",
  halftone: "Halftone",
  tunnel: "Tunnel",
};

export const VISUALIZER_OPACITY = 0.575;
export const PALETTE_BOOST = 0.5;
export const GRAIN_INTENSITY = 0.05;

export const VIGNETTE = { widthPct: 56, heightPct: 55, centerYPct: 54, inner: 0.65, middle: 0.325, outer: 0.05 } as const;

export function vignetteGradient(v: { widthPct: number; heightPct: number; centerYPct: number; inner: number; middle: number; outer: number } = VIGNETTE): string {
  const shade = (alpha: number) => `rgba(10,10,10,${alpha})`;
  return `radial-gradient(ellipse ${v.widthPct}% ${v.heightPct}% at 50% ${v.centerYPct}%, ${shade(v.inner)} 0%, ${shade(v.middle)} 55%, ${shade(v.outer)} 100%)`;
}

export const BAND_EDGES_HZ = { bass: [20, 250], mid: [250, 2000], high: [2000, 10000] } as const;
export const ATTACK_MS = { bass: 40, mid: 120, high: 60 } as const;
export const RELEASE_MS = { bass: 280, mid: 600, high: 220 } as const;

export function cycleStyle(style: VisualizerStyle, direction: 1 | -1): VisualizerStyle {
  const index = Math.max(0, VISUALIZER_STYLES.indexOf(style));
  return VISUALIZER_STYLES[(index + direction + VISUALIZER_STYLES.length) % VISUALIZER_STYLES.length];
}

export function parsePrefs(raw: string | null): VisualizerPrefs {
  const fallback: VisualizerPrefs = { on: false, style: VISUALIZER_STYLES[0] };
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<VisualizerPrefs>;
    const style = VISUALIZER_STYLES.includes(parsed.style as VisualizerStyle) ? (parsed.style as VisualizerStyle) : fallback.style;
    return { on: typeof parsed.on === "boolean" ? parsed.on : fallback.on, style };
  } catch {
    return fallback;
  }
}

export function bandBins(binHz: number, fromHz: number, toHz: number, binCount: number): [start: number, end: number] {
  const start = Math.max(0, Math.floor(fromHz / binHz));
  const end = Math.min(binCount, Math.max(start + 1, Math.ceil(toHz / binHz)));
  return [start, end];
}

function bandAverage(frequencies: Uint8Array, binHz: number, fromHz: number, toHz: number): number {
  const [start, end] = bandBins(binHz, fromHz, toHz, frequencies.length);
  if (end <= start) return 0;
  let sum = 0;
  for (let i = start; i < end; i++) sum += frequencies[i];
  return sum / (end - start) / 255;
}

export function measureBands(frequencies: Uint8Array, binHz: number, out: Bands): Bands {
  out.bass = bandAverage(frequencies, binHz, BAND_EDGES_HZ.bass[0], BAND_EDGES_HZ.bass[1]);
  out.mid = bandAverage(frequencies, binHz, BAND_EDGES_HZ.mid[0], BAND_EDGES_HZ.mid[1]);
  out.high = bandAverage(frequencies, binHz, BAND_EDGES_HZ.high[0], BAND_EDGES_HZ.high[1]);
  return out;
}

export function smoothToward(current: number, target: number, elapsedMs: number, attackMs: number, releaseMs: number): number {
  const tau = target > current ? attackMs : releaseMs;
  if (tau <= 0 || elapsedMs <= 0) return elapsedMs > 0 ? target : current;
  return current + (target - current) * (1 - Math.exp(-elapsedMs / tau));
}

export function smoothBands(current: Bands, target: Bands, elapsedMs: number): Bands {
  current.bass = smoothToward(current.bass, target.bass, elapsedMs, ATTACK_MS.bass, RELEASE_MS.bass);
  current.mid = smoothToward(current.mid, target.mid, elapsedMs, ATTACK_MS.mid, RELEASE_MS.mid);
  current.high = smoothToward(current.high, target.high, elapsedMs, ATTACK_MS.high, RELEASE_MS.high);
  return current;
}

export const BEAT_GAIN = 1.1;

export type Levels = { pulse: number; mid: number; shimmer: number };

export function reactiveLevels(bands: Bands, reducedMotion: boolean, out: Levels): Levels {
  out.pulse = reducedMotion ? 0 : bands.bass * BEAT_GAIN;
  out.mid = reducedMotion ? 0 : bands.mid;
  out.shimmer = reducedMotion ? 0 : bands.high;
  return out;
}

export function isSilentSpectrum(frequencies: Uint8Array): boolean {
  for (let i = 0; i < frequencies.length; i++) if (frequencies[i] !== 0) return false;
  return true;
}

export function flowSpeed(mid: number, reducedMotion: boolean): number {
  return reducedMotion ? 0.06 : 0.18 + mid * 0.9;
}

export type WebglSetup = "ready" | "no-context" | "failed";

export function canvasFallback(setup: WebglSetup): "none" | "same-canvas" | "fresh-canvas" {
  if (setup === "ready") return "none";
  return setup === "no-context" ? "same-canvas" : "fresh-canvas";
}

export const STYLE_BLEND_MS = 800;
export const STYLE_BLEND_REDUCED_MS = 150;

export function easeInOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function blendMix(elapsedMs: number, durationMs: number): number {
  if (durationMs <= 0) return 1;
  return easeInOutCubic(elapsedMs / durationMs);
}
