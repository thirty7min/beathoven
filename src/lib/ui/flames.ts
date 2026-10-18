export type FlameLevel = { fire: number; smoke: number; embers: number };

export type FlameShape = {
  height: number;
  width: number;
  speed: number;
  opacity: number;
  glow: number;
  rim: number;
  front: number;
  tint: number;
};

export const COLD: FlameLevel = { fire: 0, smoke: 0, embers: 0 };

const LEVELS: Record<number, FlameLevel> = {
  1: { fire: 0, smoke: 0.55, embers: 0 },
  2: { fire: 0.14, smoke: 0.8, embers: 0.25 },
  3: { fire: 0.42, smoke: 0, embers: 0.35 },
  4: { fire: 0.7, smoke: 0, embers: 0.65 },
  5: { fire: 1, smoke: 0, embers: 1 },
};

export const FIRE_BOX = { left: -3.1, right: 3.1, bottom: -1.2, top: 4 };
export const EDGE_FADE = 0.3;
export const BADGE_BORDER_PX = 1.5;
export const EDGE_AA_PX = 1.5;
export const FIRE_RESOLUTION = 0.6;
export const MAX_FIRE_DPR = 2;
export const FLAME_HALF_LIFE_MS = 70;
export const PHASE_PERIOD = 289;
export const STILL_PHASE = 3.7;
export const RESTORE_TIMEOUT_MS = 1000;

export const FLAME_BANDS = [0.02, 0.17, 0.33, 0.5] as const;
export const BAND_SOFTNESS = 0.012;
export const FLAME_PALETTE = ["#f0461b", "#ff8a1f", "#ffd23f", "#fff4c4"] as const;
export const GLOW_COLOR = "#ff7a1a";
export const RIM_COLOR = "#ffb347";
export const SMOKE_COLOR = "#8c8c8c";
export const NOISE_SCALE = { x: 1.4, y: 1 };
export const NOISE_OCTAVES = 3;
export const ENVELOPE_LIMIT = 1.25;
export const FLAME_FLICKER = 0.06;
export const FLAME_SWAY = 0.3;
export const TONGUE_SPREAD = 0.3;
export const EMBER_COUNT = 5;
export const EMBER_RADIUS = 0.1;
export const SMOKE_PUFFS = 3;
export const GLOW_ALPHA = 0.28;
export const CORONA_PROFILE = { side: -0.1, top: 1, fadeFrom: -0.8, fadeTo: -0.25 };
export const RIM_HEAT = { cold: 0.3, hot: 0.85 };

export function flameLevel(score: number | null): FlameLevel {
  if (score === null || !Number.isFinite(score)) return COLD;
  return LEVELS[Math.min(5, Math.max(1, Math.round(score)))];
}

export function approach(current: number, target: number, dtMs: number, halfLifeMs = FLAME_HALF_LIFE_MS): number {
  const next = target + (current - target) * Math.pow(2, -dtMs / halfLifeMs);
  return Math.abs(next - target) < 0.002 ? target : next;
}

export function approachLevel(current: FlameLevel, target: FlameLevel, dtMs: number): FlameLevel {
  current.fire = approach(current.fire, target.fire, dtMs);
  current.smoke = approach(current.smoke, target.smoke, dtMs);
  current.embers = approach(current.embers, target.embers, dtMs);
  return current;
}

export function isCold(level: FlameLevel): boolean {
  return level.fire === 0 && level.smoke === 0 && level.embers === 0;
}

export function fireMounted(level: FlameLevel, mounted: boolean, canFade: boolean): boolean {
  return !isCold(level) || (mounted && canFade);
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

export function createFlameShape(): FlameShape {
  return { height: 0, width: 0, speed: 0, opacity: 0, glow: 0, rim: 0, front: 0, tint: 0 };
}

export function flameShape(fire: number, out: FlameShape = createFlameShape()): FlameShape {
  const f = clamp01(fire);
  out.height = 0.3 + 1.05 * f;
  out.width = 0.15 + 0.65 * f;
  out.speed = 0.9 + 1.6 * f;
  out.opacity = Math.min(1, f / 0.1);
  out.glow = f;
  out.rim = Math.min(1, f * 1.6);
  out.front = clamp01((f - 0.4) / 0.6);
  out.tint = f * f;
  return out;
}

function smoothstep(from: number, to: number, value: number) {
  const t = clamp01((value - from) / (to - from));
  return t * t * (3 - 2 * t);
}

export function coronaLength(shape: FlameShape, up: number): number {
  const { side, top, fadeFrom, fadeTo } = CORONA_PROFILE;
  const length = shape.width + (shape.height - shape.width) * smoothstep(side, top, up);
  return length * smoothstep(fadeFrom, fadeTo, up);
}

export function rimHeat(fire: number): number {
  return RIM_HEAT.cold + (RIM_HEAT.hot - RIM_HEAT.cold) * clamp01(fire);
}

export function flameReach(shape: FlameShape) {
  const stretch = (1 + FLAME_FLICKER) * ENVELOPE_LIMIT * (1 + TONGUE_SPREAD);
  let side = 0;
  for (let degrees = -90; degrees <= 90; degrees++) {
    const angle = (degrees * Math.PI) / 180;
    side = Math.max(side, (1 + coronaLength(shape, Math.sin(angle)) * stretch) * Math.cos(angle));
  }
  return { top: 1 + coronaLength(shape, 1) * stretch, side: side + FLAME_SWAY / 2 };
}

export type BadgeEdge = { cut: number; aa: number };

export function badgeEdge(hostCssWidth: number, bufferWidth: number): BadgeEdge {
  const radius = hostCssWidth / (FIRE_BOX.right - FIRE_BOX.left);
  if (radius <= 0 || bufferWidth <= 0) return { cut: 1, aa: 0.03 };
  const aa = Math.max(EDGE_AA_PX, hostCssWidth / bufferWidth);
  return { cut: 1 - BADGE_BORDER_PX / radius, aa: aa / radius };
}

export function hexToRgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => channel / 255) as [number, number, number];
}

export function glslColor(hex: string): string {
  return `vec3(${hexToRgb(hex)
    .map((channel) => channel.toFixed(3))
    .join(", ")})`;
}

export function glslFloat(value: number): string {
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

export function advancePhase(phase: number, dtMs: number, speed: number): number {
  return (phase + (dtMs / 1000) * speed) % PHASE_PERIOD;
}

export function fireBufferSize(cssWidth: number, cssHeight: number, dpr: number) {
  const scale = Math.min(Math.max(dpr, 1), MAX_FIRE_DPR) * FIRE_RESOLUTION;
  return { width: Math.max(1, Math.round(cssWidth * scale)), height: Math.max(1, Math.round(cssHeight * scale)) };
}

export function fireBoxStyle(box = FIRE_BOX) {
  const percent = (radii: number) => `${(radii / 2) * 100}%`;
  return {
    left: percent(box.left + 1),
    top: percent(1 - box.top),
    width: percent(box.right - box.left),
    height: percent(box.top - box.bottom),
  };
}
