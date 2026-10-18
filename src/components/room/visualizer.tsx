"use client";

import { AudioWaveform, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "@/components/ui/cn";
import {
  GRAIN_INTENSITY,
  STYLE_BLEND_MS,
  STYLE_BLEND_REDUCED_MS,
  STYLE_LABELS,
  VISUALIZER_OPACITY,
  VISUALIZER_STYLES,
  blendMix,
  canvasFallback,
  flowSpeed,
  isSilentSpectrum,
  measureBands,
  reactiveLevels,
  smoothBands,
  type Bands,
  type Levels,
  type VisualizerStyle,
  type WebglSetup,
} from "@/lib/ui/visualizer";
import { FALLBACK_COLORS, VERTEX_SHADER, fragmentShader } from "./visualizer-shaders";

const RESOLUTION_SCALE = 0.5;
const MAX_DPR = 2;
const CALM_FRAME_MS = 33;
const GRAIN_TILE = 160;
const SILENT_WARN_MS = 3000;

let grainTexture: string | null = null;

function grainUrl(): string {
  if (grainTexture) return grainTexture;
  const canvas = document.createElement("canvas");
  canvas.width = GRAIN_TILE;
  canvas.height = GRAIN_TILE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const image = ctx.createImageData(GRAIN_TILE, GRAIN_TILE);
  for (let i = 0; i < image.data.length; i += 4) {
    const v = Math.random() * 255;
    image.data[i] = v;
    image.data[i + 1] = v;
    image.data[i + 2] = v;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  grainTexture = `url(${canvas.toDataURL("image/png")})`;
  return grainTexture;
}

type Frame = { time: number; pulse: number; shimmer: number; mid: number };

type Renderer = {
  resize: (width: number, height: number) => void;
  setStyle: (style: VisualizerStyle, now: number) => void;
  draw: (frame: Frame, now: number) => void;
  dispose: () => void;
};

type Blend<T> = { from: T; startedAt: number } | null;

const COMPOSITE_SHADER = `
precision mediump float;
uniform vec2 u_resolution;
uniform sampler2D u_from;
uniform sampler2D u_to;
uniform float u_mix;
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  gl_FragColor = mix(texture2D(u_from, uv), texture2D(u_to, uv), u_mix);
}
`;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  return null;
}

type Program = {
  program: WebGLProgram;
  shaders: WebGLShader[];
  uniform: (name: string) => WebGLUniformLocation | null;
};

function link(gl: WebGLRenderingContext, fragmentSource: string): Program | null {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.bindAttribLocation(program, 0, "a_position");
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  const cache = new Map<string, WebGLUniformLocation | null>();
  return {
    program,
    shaders: [vertex, fragment],
    uniform: (name) => {
      if (!cache.has(name)) cache.set(name, gl.getUniformLocation(program, name));
      return cache.get(name) ?? null;
    },
  };
}

type Target = { framebuffer: WebGLFramebuffer; texture: WebGLTexture };

function webglRenderer(canvas: HTMLCanvasElement, initial: VisualizerStyle, blendMs: number): Renderer | Exclude<WebglSetup, "ready"> {
  const gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, powerPreference: "low-power" });
  if (!gl) return "no-context";
  const fail = (): "failed" => {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return "failed";
  };
  const styles = new Map<VisualizerStyle, Program>();
  for (const style of VISUALIZER_STYLES) {
    const linked = link(gl, fragmentShader(style));
    if (!linked) return fail();
    styles.set(style, linked);
  }
  const composite = link(gl, COMPOSITE_SHADER);
  if (!composite) return fail();

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const targets: Target[] = [];
  for (let i = 0; i < 4; i++) {
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) return fail();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    targets.push({ framebuffer, texture });
  }
  const [fromTarget, toTarget, ...snapshots] = targets;
  let snapshotIndex = 0;
  let width = 1;
  let height = 1;
  let current = initial;
  let blend: Blend<VisualizerStyle | "snapshot"> = null;
  let lastMix = 1;

  function renderStyle(style: VisualizerStyle, target: Target | null, frame: Frame) {
    const p = styles.get(style)!;
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, target?.framebuffer ?? null);
    gl!.useProgram(p.program);
    gl!.uniform2f(p.uniform("u_resolution"), width, height);
    gl!.uniform1f(p.uniform("u_time"), frame.time);
    gl!.uniform1f(p.uniform("u_pulse"), frame.pulse);
    gl!.uniform1f(p.uniform("u_shimmer"), frame.shimmer);
    gl!.uniform1f(p.uniform("u_mid"), frame.mid);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
  }

  function compositeInto(from: WebGLTexture, to: WebGLTexture, mix: number, target: Target | null) {
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, target?.framebuffer ?? null);
    gl!.useProgram(composite!.program);
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, from);
    gl!.activeTexture(gl!.TEXTURE1);
    gl!.bindTexture(gl!.TEXTURE_2D, to);
    gl!.uniform1i(composite!.uniform("u_from"), 0);
    gl!.uniform1i(composite!.uniform("u_to"), 1);
    gl!.uniform1f(composite!.uniform("u_mix"), mix);
    gl!.uniform2f(composite!.uniform("u_resolution"), width, height);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
  }

  function outgoingTexture() {
    return blend?.from === "snapshot" ? snapshots[snapshotIndex].texture : fromTarget.texture;
  }

  return {
    resize(w, h) {
      width = w;
      height = h;
      gl.viewport(0, 0, w, h);
      for (const target of targets) {
        gl.bindTexture(gl.TEXTURE_2D, target.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.texture, 0);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },
    setStyle(style, now) {
      if (style === current) return;
      if (blend && lastMix < 1) {
        const next = 1 - snapshotIndex;
        compositeInto(outgoingTexture(), toTarget.texture, lastMix, snapshots[next]);
        snapshotIndex = next;
        blend = { from: "snapshot", startedAt: now };
      } else {
        blend = { from: current, startedAt: now };
      }
      current = style;
      lastMix = 0;
    },
    draw(frame, now) {
      if (blend) {
        lastMix = blendMix(now - blend.startedAt, blendMs);
        if (lastMix >= 1) blend = null;
      }
      if (!blend) {
        renderStyle(current, null, frame);
        return;
      }
      if (blend.from !== "snapshot") renderStyle(blend.from, fromTarget, frame);
      renderStyle(current, toTarget, frame);
      compositeInto(outgoingTexture(), toTarget.texture, lastMix, null);
    },
    dispose() {
      for (const target of targets) {
        gl.deleteFramebuffer(target.framebuffer);
        gl.deleteTexture(target.texture);
      }
      for (const p of [...styles.values(), composite]) {
        for (const shader of p.shaders) gl.deleteShader(shader);
        gl.deleteProgram(p.program);
      }
      gl.deleteBuffer(buffer);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}

function canvasRenderer(canvas: HTMLCanvasElement, initial: VisualizerStyle, blendMs: number): Renderer | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  let width = 0;
  let height = 0;
  let current = initial;
  let blend: Blend<VisualizerStyle> = null;

  function paint(style: VisualizerStyle, alpha: number, t: number, p: number) {
    const [inner, outer] = FALLBACK_COLORS[style];
    const radius = Math.max(width, height) * (0.35 + p * 0.25);
    const x = width / 2 + Math.sin(t * 0.4) * width * 0.08;
    const y = height / 2 + Math.cos(t * 0.3) * height * 0.06;
    const gradient = ctx!.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, inner);
    gradient.addColorStop(1, outer);
    ctx!.globalAlpha = alpha * (0.5 + p * 0.5);
    ctx!.fillStyle = gradient;
    ctx!.fillRect(0, 0, width, height);
  }

  return {
    resize(w, h) {
      width = w;
      height = h;
    },
    setStyle(style, now) {
      if (style === current) return;
      blend = { from: current, startedAt: now };
      current = style;
    },
    draw({ time, pulse }, now) {
      const mix = blend ? blendMix(now - blend.startedAt, blendMs) : 1;
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);
      if (blend && mix < 1) paint(blend.from, 1 - mix, time, pulse);
      else blend = null;
      paint(current, mix, time, pulse);
      ctx.globalAlpha = 1;
    },
    dispose() {},
  };
}

function mountCanvas(host: HTMLElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  host.appendChild(canvas);
  return canvas;
}

export function VisualizerCanvas({
  analyser,
  playing,
  style,
  reducedMotion,
}: {
  analyser: () => AnalyserNode | null;
  playing: boolean;
  style: VisualizerStyle;
  reducedMotion: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const grainRef = useRef<HTMLDivElement>(null);
  const playingRef = useRef(playing);
  const styleRef = useRef(style);
  const loop = useRef<{ start: () => void; stop: () => void; setStyle: (style: VisualizerStyle) => void } | null>(null);

  useEffect(() => {
    playingRef.current = playing;
    if (playing) loop.current?.start();
    else loop.current?.stop();
  }, [playing]);

  useEffect(() => {
    styleRef.current = style;
    loop.current?.setStyle(style);
  }, [style]);

  useEffect(() => {
    if (grainRef.current) grainRef.current.style.backgroundImage = grainUrl();
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let canvas = mountCanvas(host);
    const blendMs = reducedMotion ? STYLE_BLEND_REDUCED_MS : STYLE_BLEND_MS;
    const attempt = webglRenderer(canvas, styleRef.current, blendMs);
    const plan = canvasFallback(typeof attempt === "string" ? attempt : "ready");
    if (plan === "fresh-canvas") {
      canvas.remove();
      canvas = mountCanvas(host);
    }
    let renderer: Renderer | null = typeof attempt === "string" ? canvasRenderer(canvas, styleRef.current, blendMs) : attempt;
    const frameLevels: Frame = { time: 0, pulse: 0, shimmer: 0, mid: 0 };
    if (!renderer) {
      canvas.remove();
      return;
    }
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const scale = Math.min(MAX_DPR, window.devicePixelRatio || 1) * RESOLUTION_SCALE;
      canvas.width = Math.max(1, Math.round(rect.width * scale));
      canvas.height = Math.max(1, Math.round(rect.height * scale));
      renderer?.resize(canvas.width, canvas.height);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const target: Bands = { bass: 0, mid: 0, high: 0 };
    const smoothed: Bands = { bass: 0, mid: 0, high: 0 };
    const levels: Levels = { pulse: 0, mid: 0, shimmer: 0 };
    let frequencies: Uint8Array<ArrayBuffer> | null = null;
    let silentSince: number | null = null;
    let warned = false;
    let clock = 0;
    let frame = 0;
    let last = performance.now();

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const elapsed = Math.min(100, now - last);
      if (reducedMotion && elapsed < CALM_FRAME_MS) return;
      last = now;
      const node = analyser();
      if (node && !reducedMotion) {
        if (!frequencies || frequencies.length !== node.frequencyBinCount) frequencies = new Uint8Array(node.frequencyBinCount);
        node.getByteFrequencyData(frequencies);
        measureBands(frequencies, node.context.sampleRate / node.fftSize, target);
        if (process.env.NODE_ENV === "development" && !warned) {
          silentSince = isSilentSpectrum(frequencies) ? (silentSince ?? now) : null;
          if (silentSince !== null && now - silentSince > SILENT_WARN_MS) {
            console.warn(`Visualizer analyser is silent while playing (AudioContext ${node.context.state}).`);
            warned = true;
          }
        }
      } else {
        target.bass = 0;
        target.mid = 0;
        target.high = 0;
        if (process.env.NODE_ENV === "development" && !node && !reducedMotion && !warned) {
          console.warn("Visualizer has no analyser: the audio element isn't connected to the audio graph.");
          warned = true;
        }
      }
      smoothBands(smoothed, target, elapsed);
      clock += (elapsed / 1000) * flowSpeed(smoothed.mid, reducedMotion);
      reactiveLevels(smoothed, reducedMotion, levels);
      frameLevels.time = clock;
      frameLevels.pulse = levels.pulse;
      frameLevels.shimmer = levels.shimmer;
      frameLevels.mid = levels.mid;
      renderer?.draw(frameLevels, now);
    };
    const start = () => {
      if (frame || document.hidden || !playingRef.current || !renderer) return;
      last = performance.now();
      frame = requestAnimationFrame(draw);
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    const onLost = (e: Event) => {
      e.preventDefault();
      stop();
      renderer = null;
    };
    const onRestored = () => {
      const restored = webglRenderer(canvas, styleRef.current, blendMs);
      renderer = typeof restored === "string" ? null : restored;
      resize();
      start();
    };
    loop.current = { start, stop, setStyle: (next) => renderer?.setStyle(next, performance.now()) };
    document.addEventListener("visibilitychange", onVisibility);
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    start();
    return () => {
      stop();
      loop.current = null;
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      renderer?.dispose();
      canvas.remove();
    };
  }, [analyser, reducedMotion]);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        ref={hostRef}
        className="absolute inset-0 animate-crossfade transition-opacity duration-300 ease-snappy"
        style={{ opacity: playing ? VISUALIZER_OPACITY : 0 }}
      />
      <div className="absolute inset-0 transition-opacity duration-300 ease-snappy" style={{ opacity: playing ? GRAIN_INTENSITY : 0 }}>
        <div ref={grainRef} className={cn("absolute -inset-1/4 mix-blend-screen", !reducedMotion && "animate-grain")} />
      </div>
    </div>
  );
}

export function VisualizerControl({
  on,
  style,
  onToggle,
  onCycle,
}: {
  on: boolean;
  style: VisualizerStyle;
  onToggle: () => void;
  onCycle: (direction: 1 | -1) => void;
}) {
  return (
    <div className="flex h-10 items-center rounded-full border border-line-strong bg-surface text-sm shadow-2xl">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={on}
        aria-label={on ? "Turn visualizer off" : "Turn visualizer on"}
        className={cn(
          "flex h-full items-center rounded-full px-3 transition-[transform,color] duration-150 ease-snappy active:scale-[0.97]",
          on ? "text-fg" : "text-muted hover:text-fg",
        )}
      >
        <AudioWaveform className="h-4 w-4" />
      </button>
      {on && (
        <div className="flex animate-fade-in items-center border-l border-line pr-1">
          <button
            type="button"
            onClick={() => onCycle(-1)}
            aria-label="Previous visualizer style"
            className="rounded-full p-1.5 text-muted transition-[transform,color] duration-150 ease-snappy hover:text-fg active:scale-[0.97]"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span key={style} className="w-16 animate-crossfade text-center text-xs font-semibold">
            {STYLE_LABELS[style]}
          </span>
          <button
            type="button"
            onClick={() => onCycle(1)}
            aria-label="Next visualizer style"
            className="rounded-full p-1.5 text-muted transition-[transform,color] duration-150 ease-snappy hover:text-fg active:scale-[0.97]"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
