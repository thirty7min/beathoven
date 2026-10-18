import {
  BAND_SOFTNESS,
  EDGE_FADE,
  EMBER_COUNT,
  EMBER_RADIUS,
  ENVELOPE_LIMIT,
  FIRE_BOX,
  FLAME_BANDS,
  FLAME_FLICKER,
  FLAME_PALETTE,
  FLAME_SWAY,
  GLOW_ALPHA,
  GLOW_COLOR,
  NOISE_OCTAVES,
  NOISE_SCALE,
  PHASE_PERIOD,
  RIM_COLOR,
  SMOKE_COLOR,
  SMOKE_PUFFS,
  glslColor,
  glslFloat,
  type BadgeEdge,
  type FlameLevel,
  type FlameShape,
} from "@/lib/ui/flames";

export type FireFrame = { phase: number; level: FlameLevel; shape: FlameShape; edge: BadgeEdge };

export type FireRenderer = {
  draw: (frame: FireFrame) => void;
  clear: () => void;
  dispose: () => void;
};

export const FIRE_CONTEXT: WebGLContextAttributes = {
  alpha: true,
  premultipliedAlpha: true,
  antialias: false,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: false,
  powerPreference: "low-power",
};

const VERTEX = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const PERIOD = glslFloat(PHASE_PERIOD);
const [B0, B1, B2, B3] = FLAME_BANDS.map(glslFloat);
const [RED, ORANGE, YELLOW, CORE] = FLAME_PALETTE.map(glslColor);
const SOFT = glslFloat(BAND_SOFTNESS);

const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec4 u_box;
uniform vec2 u_edge;
uniform vec4 u_shape;
uniform vec4 u_light;
uniform vec3 u_level;
uniform float u_phase;
varying vec2 v_uv;

float hash(vec2 i) {
  i = mod(i, ${PERIOD});
  float h = mod((i.x * 34.0 + 1.0) * i.x, ${PERIOD});
  h = mod(((h + i.y) * 34.0 + 1.0) * (h + i.y), ${PERIOD});
  return h / ${PERIOD};
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  float total = 0.0;
  for (int i = 0; i < ${NOISE_OCTAVES}; i++) {
    value += amplitude * noise(p);
    total += amplitude;
    p = p * 2.0 + vec2(17.0, 9.0);
    amplitude *= 0.5;
  }
  return value / total;
}

float band(float t, float edge) {
  return smoothstep(edge - ${SOFT}, edge + ${SOFT}, t);
}

vec4 flame(float t) {
  vec3 c = mix(${RED}, ${ORANGE}, band(t, ${B1}));
  c = mix(c, ${YELLOW}, band(t, ${B2}));
  c = mix(c, ${CORE}, band(t, ${B3}));
  return vec4(c, band(t, ${B0}));
}

vec4 over(vec4 below, vec3 color, float alpha) {
  return vec4(color * alpha + below.rgb * (1.0 - alpha), alpha + below.a * (1.0 - alpha));
}

vec4 over(vec4 below, vec4 layer, float mask) {
  return over(below, layer.rgb, layer.a * mask);
}

void main() {
  vec2 p = vec2(mix(u_box.x, u_box.y, v_uv.x), mix(u_box.z, u_box.w, v_uv.y));
  float r = length(p);
  float up = p.y / max(r, 0.001);
  float outside = smoothstep(u_edge.x - u_edge.y, u_edge.x, r);
  float inside = 1.0 - outside;
  float flicker = 1.0 + ${glslFloat(FLAME_FLICKER)} * (2.0 * noise(vec2(u_phase * 2.0, 7.0)) - 1.0);
  float height = u_shape.x * flicker;
  float width = u_shape.y;

  vec2 q = vec2(p.x * ${glslFloat(NOISE_SCALE.x)}, p.y * ${glslFloat(NOISE_SCALE.y)} - u_phase);
  vec2 warp = vec2(fbm(q + vec2(0.0, 31.0)), fbm(q + vec2(57.0, 13.0))) - 0.5;
  float n = fbm(q + warp * 1.2);

  float lift = clamp(p.y / height, 0.0, 1.0);
  vec2 e = vec2((p.x + warp.x * ${glslFloat(FLAME_SWAY)} * lift) / (width * (1.0 - 0.55 * lift)), p.y > 0.0 ? p.y / height : p.y / 0.55);
  float reach = length(e);
  float heat = 1.0 - reach + (n - 0.5) * (0.25 + 0.6 * lift);
  heat *= 1.0 - smoothstep(1.0, ${glslFloat(ENVELOPE_LIMIT)}, reach);
  float seam = (r - 1.0) / 0.1;
  heat += exp(-seam * seam) * smoothstep(-0.55, 0.3, p.y) * (0.3 + 0.4 * n) * u_light.y;
  heat *= u_shape.w;
  heat *= (1.0 - smoothstep(u_box.w - ${glslFloat(EDGE_FADE)}, u_box.w, p.y)) * (1.0 - smoothstep(u_box.y - ${glslFloat(EDGE_FADE)}, u_box.y, abs(p.x)));

  float smoke = 0.0;
  for (int i = 0; i < ${SMOKE_PUFFS}; i++) {
    float fi = float(i);
    float life = fract(u_phase * 70.0 / ${PERIOD} + fi / ${glslFloat(SMOKE_PUFFS)});
    vec2 center = vec2(sin(life * 4.0 + fi * 2.1) * 0.25, 0.9 + life * 2.0);
    float radius = 0.22 + 0.35 * life;
    float puff = 1.0 - smoothstep(radius * 0.55, radius, length(p - center));
    smoke = max(smoke, puff * (1.0 - life) * smoothstep(0.0, 0.2, life));
  }
  smoke *= u_level.y * 0.4;

  float halo = length(vec2(p.x, (p.y - 0.2 * u_light.x) * 0.9)) - 1.0;
  float haloRadius = (0.25 + 0.45 * u_light.x) * flicker;
  float glow = (1.0 - smoothstep(haloRadius * 0.35, haloRadius, halo)) * outside * ${glslFloat(GLOW_ALPHA)} * u_light.x * (0.85 + 0.3 * n);
  float rim = smoothstep(0.78, 0.96, r) * inside * smoothstep(0.1, 0.5, up) * u_light.y * 0.55 * flicker;
  float tint = inside * u_light.w * 0.12 * smoothstep(-0.2, 1.0, p.y);

  vec2 fq = vec2(p.x * ${glslFloat(NOISE_SCALE.x * 1.4)}, p.y * ${glslFloat(NOISE_SCALE.y * 1.4)} - u_phase * 2.0);
  float tongue = fbm(fq + vec2(71.0, 5.0) + warp);
  float engulf = u_light.z * smoothstep(-0.3, 0.6, up);
  float depth = r + (tongue - 0.5) * 0.2 * engulf;
  float overlap = smoothstep(mix(0.9, 0.55, engulf), mix(1.0, 0.75, engulf), depth) * smoothstep(-0.9, -0.3, up);
  float cover = max(outside, overlap);

  float sparks = 0.0;
  for (int i = 0; i < ${EMBER_COUNT}; i++) {
    float fi = float(i);
    float a = hash(vec2(fi, 11.0));
    float b = hash(vec2(fi, 23.0));
    float c = hash(vec2(fi, 37.0));
    float life = fract(u_phase * (110.0 + floor(b * 50.0)) / ${PERIOD} + c);
    float x = (a - 0.5) * 1.4;
    vec2 pos = vec2(x + sin(life * 5.0 + a * 6.2832) * 0.18, sqrt(max(1.0 - x * x, 0.0)) - 0.05 + life * u_shape.x * 0.9);
    float radius = ${glslFloat(EMBER_RADIUS)} * (1.0 - life) * clamp(u_level.z * ${glslFloat(EMBER_COUNT)} - fi, 0.0, 1.0);
    sparks = max(sparks, 1.0 - smoothstep(radius - 0.025, radius, length(p - pos)));
  }

  vec4 color = vec4(${glslColor(SMOKE_COLOR)} * smoke, smoke);
  color = over(color, ${glslColor(GLOW_COLOR)}, clamp(glow, 0.0, 1.0));
  color = over(color, ${glslColor(RIM_COLOR)}, rim);
  color = over(color, ${glslColor(GLOW_COLOR)}, tint);
  color = over(color, flame(heat), cover);
  color = over(color, ${YELLOW}, sparks);
  gl_FragColor = color;
}
`;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  if (process.env.NODE_ENV !== "production" && !gl.isContextLost()) console.error("fire shader:", gl.getShaderInfoLog(shader));
  gl.deleteShader(shader);
  return null;
}

export function createFireRenderer(gl: WebGLRenderingContext): FireRenderer | null {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  const buffer = gl.createBuffer();
  const release = () => {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    gl.deleteProgram(program);
    gl.deleteBuffer(buffer);
  };
  if (!vertex || !fragment || !program || !buffer) {
    release();
    return null;
  }

  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    if (process.env.NODE_ENV !== "production" && !gl.isContextLost()) console.error("fire program:", gl.getProgramInfoLog(program));
    release();
    return null;
  }

  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  gl.uniform4f(gl.getUniformLocation(program, "u_box"), FIRE_BOX.left, FIRE_BOX.right, FIRE_BOX.bottom, FIRE_BOX.top);
  const shape = gl.getUniformLocation(program, "u_shape");
  const light = gl.getUniformLocation(program, "u_light");
  const level = gl.getUniformLocation(program, "u_level");
  const phase = gl.getUniformLocation(program, "u_phase");
  const edge = gl.getUniformLocation(program, "u_edge");
  gl.disable(gl.BLEND);
  gl.clearColor(0, 0, 0, 0);

  return {
    draw(frame) {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.uniform4f(shape, frame.shape.height, frame.shape.width, frame.shape.speed, frame.shape.opacity);
      gl.uniform4f(light, frame.shape.glow, frame.shape.rim, frame.shape.front, frame.shape.tint);
      gl.uniform3f(level, frame.level.fire, frame.level.smoke, frame.level.embers);
      gl.uniform1f(phase, frame.phase);
      gl.uniform2f(edge, frame.edge.cut, frame.edge.aa);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    clear() {
      gl.clear(gl.COLOR_BUFFER_BIT);
    },
    dispose: release,
  };
}

let shaderSupport: boolean | undefined;

export function supportsFireShader(): boolean {
  if (shaderSupport !== undefined) return shaderSupport;
  const gl = document.createElement("canvas").getContext("webgl", FIRE_CONTEXT);
  const renderer = gl && createFireRenderer(gl);
  shaderSupport = Boolean(renderer);
  renderer?.dispose();
  gl?.getExtension("WEBGL_lose_context")?.loseContext();
  return shaderSupport;
}
