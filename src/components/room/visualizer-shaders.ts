import { PALETTE_BOOST, type VisualizerStyle } from "@/lib/ui/visualizer";

export const VERTEX_SHADER = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const COMMON = `
precision mediump float;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_pulse;
uniform float u_shimmer;
uniform float u_mid;
const float BOOST = ${PALETTE_BOOST.toFixed(3)};

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

vec2 centered() {
  return (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
}

float blob(vec2 uv, vec2 center, float radius) {
  vec2 d = uv - center;
  return exp(-dot(d, d) / (radius * radius));
}
`;

const AURORA = `
void main() {
  vec2 uv = centered();
  float t = u_time;
  float radius = 0.42 + u_pulse * 0.22;
  vec3 color = vec3(0.0);
  color += mix(vec3(0.05, 0.75, 0.65), vec3(0.0, 0.95, 0.75), BOOST) * blob(uv, vec2(sin(t * 0.71) * 0.7, cos(t * 0.53) * 0.35), radius);
  color += mix(vec3(0.45, 0.2, 0.95), vec3(0.55, 0.1, 1.0), BOOST) * blob(uv, vec2(cos(t * 0.47) * 0.8, sin(t * 0.61) * 0.4), radius);
  color += mix(vec3(0.95, 0.25, 0.6), vec3(1.0, 0.1, 0.55), BOOST) * blob(uv, vec2(sin(t * 0.37 + 2.0) * 0.6, cos(t * 0.83 + 1.0) * 0.45), radius * 0.9);
  color += mix(vec3(0.15, 0.4, 1.0), vec3(0.05, 0.35, 1.0), BOOST) * blob(uv, vec2(cos(t * 0.29 + 4.0) * 0.75, sin(t * 0.43 + 3.0) * 0.3), radius * 1.1);
  color *= mix(0.5, 0.8, BOOST) + u_pulse * mix(0.75, 0.9, BOOST);
  color += u_shimmer * 0.12 * noise(uv * 38.0 + t * 3.0);
  gl_FragColor = vec4(color, 1.0);
}
`;

const PLASMA = `
void main() {
  vec2 uv = centered() * (1.6 - u_pulse * 0.35);
  float t = u_time;
  float v = sin(uv.x * 3.0 + t) + sin(uv.y * 3.4 - t * 1.2) + sin((uv.x + uv.y) * 2.6 + t * 0.7) + sin(length(uv * 3.5) - t * 1.4);
  v = v * 0.25 + u_pulse * 0.35;
  vec3 color = 0.5 + 0.5 * cos(6.2831 * (v + vec3(0.0, 0.18, 0.42)));
  color = mix(color, mix(vec3(1.0, 0.45, 0.25), vec3(1.0, 0.4, 0.15), BOOST) * color.r, mix(0.35, 0.3, BOOST));
  color = mix(color, pow(color, vec3(1.5)) * 1.35, BOOST);
  color *= mix(0.35, 0.65, BOOST) + u_pulse * mix(0.55, 0.7, BOOST);
  color += u_shimmer * 0.1 * noise(uv * 44.0 - t * 4.0);
  gl_FragColor = vec4(color, 1.0);
}
`;

const GLOW = `
void main() {
  vec2 uv = centered();
  float t = u_time;
  float d = length(uv);
  float angle = atan(uv.y, uv.x);
  float ripple = 0.04 * sin(angle * 5.0 + t * 1.3) + 0.03 * noise(vec2(angle * 2.0, t * 0.5));
  float falloff = exp(-pow(d + ripple, 2.0) * (5.0 - u_pulse * 3.0));
  vec3 inner = mix(vec3(1.0, 0.72, 0.35), vec3(1.0, 0.68, 0.2), BOOST);
  vec3 outer = mix(vec3(0.35, 0.12, 0.65), vec3(0.45, 0.05, 0.85), BOOST);
  vec3 color = mix(outer, inner, falloff) * falloff * (mix(0.55, 0.85, BOOST) + u_pulse * mix(0.8, 0.9, BOOST));
  color += u_shimmer * 0.12 * noise(uv * 50.0 + t * 5.0) * falloff;
  gl_FragColor = vec4(color, 1.0);
}
`;

const KALEIDO = `
void main() {
  vec2 uv = centered();
  float t = u_time;
  float r = length(uv);
  float segment = 6.2831 / 8.0;
  float a = mod(atan(uv.y, uv.x) + t * 0.25, segment);
  a = abs(a - segment * 0.5);
  vec2 p = vec2(cos(a), sin(a)) * r * (2.4 - u_pulse * 0.9);
  float v = sin(p.x * 6.0 + t) * cos(p.y * 6.0 - t * 0.8) + sin(r * 10.0 - t * 2.0 - u_pulse * 3.0);
  vec3 color = 0.5 + 0.5 * cos(6.2831 * (v * 0.35 + r * 0.6 + t * 0.05 + vec3(0.0, 0.33, 0.67)));
  color = mix(color, pow(color, vec3(1.6)) * 1.3, BOOST);
  color *= (mix(0.55, 0.75, BOOST) + u_pulse * 0.9) * smoothstep(1.4, 0.1, r);
  color += u_shimmer * 0.15 * noise(p * 30.0 + t * 4.0);
  gl_FragColor = vec4(color, 1.0);
}
`;

const HALFTONE = `
void main() {
  vec2 uv = centered();
  float t = u_time;
  float cells = 18.0;
  vec2 grid = uv * cells;
  vec2 id = floor(grid);
  vec2 local = fract(grid) - 0.5;
  vec2 cell = (id + 0.5) / cells;
  float dist = length(cell);
  float field = 0.5 + 0.5 * sin(cell.x * 3.0 + t * 0.8) * cos(cell.y * 2.6 - t * 0.6);
  float ripple = 0.5 + 0.5 * sin(dist * 16.0 - t * 7.0);
  float beat = u_pulse * u_pulse;
  float radius = 0.06 + field * 0.1 + ripple * u_mid * 0.22 + beat * 0.34;
  radius = min(radius, 0.62);
  float dotMask = smoothstep(radius, radius - 0.08, length(local));
  float hue = dist * 0.35 + field * 0.15 + u_pulse * 0.45 + u_mid * 0.25 + t * 0.03;
  vec3 color = 0.5 + 0.5 * cos(6.2831 * (hue + vec3(0.0, 0.33, 0.67)));
  color = mix(color, pow(color, vec3(1.4)) * 1.2, BOOST);
  color *= dotMask * (0.45 + ripple * u_mid * 0.5 + u_pulse * 1.1) * smoothstep(1.3, 0.2, dist);
  color += u_shimmer * 0.25 * dotMask * noise(id + t * 6.0);
  gl_FragColor = vec4(color, 1.0);
}
`;

const TUNNEL = `
void main() {
  vec2 uv = centered();
  float t = u_time;
  float r = length(uv) + 0.001;
  float a = atan(uv.y, uv.x);
  float depth = 0.35 / r + t * 1.2 + u_pulse * 0.6;
  float rings = pow(0.5 + 0.5 * sin(depth * 9.42), 6.0 - u_pulse * 3.0);
  float spokes = 0.5 + 0.5 * sin(a * 12.0 + depth * 2.0);
  vec3 color = 0.5 + 0.5 * cos(6.2831 * (depth * 0.15 + vec3(0.6, 0.1, 0.85)));
  color = color * color * (rings * 1.2 + spokes * 0.15);
  color *= smoothstep(0.0, 0.25, r) * (0.85 + u_pulse * 0.9);
  color += u_shimmer * 0.15 * noise(vec2(a * 8.0, depth * 4.0));
  gl_FragColor = vec4(color, 1.0);
}
`;

const FRAGMENTS: Record<VisualizerStyle, string> = {
  aurora: AURORA,
  plasma: PLASMA,
  glow: GLOW,
  kaleido: KALEIDO,
  halftone: HALFTONE,
  tunnel: TUNNEL,
};

export function fragmentShader(style: VisualizerStyle): string {
  return COMMON + FRAGMENTS[style];
}

export const FALLBACK_COLORS: Record<VisualizerStyle, [string, string]> = {
  aurora: ["rgba(40, 200, 180, 0.9)", "rgba(110, 60, 240, 0)"],
  plasma: ["rgba(255, 120, 70, 0.9)", "rgba(200, 40, 140, 0)"],
  glow: ["rgba(255, 185, 90, 0.9)", "rgba(90, 30, 170, 0)"],
  kaleido: ["rgba(255, 90, 200, 0.9)", "rgba(40, 200, 255, 0)"],
  halftone: ["rgba(0, 215, 255, 0.9)", "rgba(255, 30, 140, 0)"],
  tunnel: ["rgba(140, 80, 255, 0.9)", "rgba(255, 60, 120, 0)"],
};
