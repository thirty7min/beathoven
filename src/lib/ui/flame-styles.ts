export const FLAME_STYLES = ["classic", "sticker", "embers", "heat"] as const;
export type FlameStyle = (typeof FLAME_STYLES)[number];
export const DEFAULT_FLAME_STYLE: FlameStyle = "classic";

export function isFlameStyle(value: unknown): value is FlameStyle {
  return FLAME_STYLES.includes(value as FlameStyle);
}

export function chooseFlameStyle(param: string | null, saved: string | null): FlameStyle {
  if (isFlameStyle(param)) return param;
  if (isFlameStyle(saved)) return saved;
  return DEFAULT_FLAME_STYLE;
}

export function nextFlameStyle(style: FlameStyle): FlameStyle {
  return FLAME_STYLES[(FLAME_STYLES.indexOf(style) + 1) % FLAME_STYLES.length];
}

export function heatLevel(score: number | null): number {
  if (score === null || !Number.isFinite(score)) return 0;
  return (Math.min(5, Math.max(1, Math.round(score))) - 1) / 4;
}

export const TONGUES = [
  { x: 0, height: 1, width: 1, from: 0 },
  { x: -0.55, height: 0.68, width: 0.72, from: 0.4 },
  { x: 0.58, height: 0.6, width: 0.68, from: 0.65 },
] as const;

export function tongueScale(heat: number, from: number): number {
  if (heat <= from) return 0;
  return 0.45 + 0.55 * Math.min(1, (heat - from) / Math.max(0.0001, 1 - from));
}

export const HEAT_STOPS = ["#f5f5f5", "#ffd9a8", "#ff9a3c", "#ff5a1f", "#d6e6ff"] as const;

export function heatColor(score: number | null): string {
  if (score === null || !Number.isFinite(score)) return "currentColor";
  return HEAT_STOPS[Math.min(5, Math.max(1, Math.round(score))) - 1];
}

export function heatGlow(score: number | null): number {
  const heat = heatLevel(score);
  return heat <= 0 ? 0 : 0.25 + 0.75 * heat;
}

export type Ember = { x: number; y: number; vx: number; vy: number; age: number; life: number; size: number };

export const EMBER_MAX = 36;
export const EMBER_RISE = 1.6;
export const EMBER_LIFE_MS = 1400;
export const EMBER_SWAY = 0.25;

export function emberRate(score: number | null): number {
  const heat = heatLevel(score);
  return heat <= 0 ? 0 : 4 + 28 * heat * heat;
}

export function spawnEmber(heat: number, random: () => number): Ember {
  const angle = Math.PI * (0.15 + 0.7 * random());
  return {
    x: Math.cos(angle) * 1.02,
    y: Math.sin(angle) * 1.02,
    vx: (random() - 0.5) * 0.5,
    vy: EMBER_RISE * (0.6 + 0.8 * random()) * (0.6 + 0.4 * heat),
    age: 0,
    life: EMBER_LIFE_MS * (0.6 + 0.6 * random()),
    size: 0.05 + 0.06 * random() * (0.5 + heat),
  };
}

export function stepEmber(ember: Ember, dtMs: number): boolean {
  const dt = dtMs / 1000;
  ember.age += dtMs;
  ember.x += ember.vx * dt + Math.sin(ember.age / 180 + ember.life) * EMBER_SWAY * dt;
  ember.y += ember.vy * dt;
  ember.vy *= Math.pow(0.7, dt);
  return ember.age < ember.life;
}

export function emberColor(progress: number): string {
  const t = Math.min(1, Math.max(0, progress));
  if (t < 0.25) return "#fff4c4";
  if (t < 0.55) return "#ffd23f";
  if (t < 0.8) return "#ff8a1f";
  return "#f0461b";
}
