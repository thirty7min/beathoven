"use client";

import { AudioWaveform, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "@/components/ui/cn";
import {
  GRAIN_INTENSITY,
  STYLE_LABELS,
  VISUALIZER_OPACITY,
  canvasFallback,
  flowSpeed,
  measureBands,
  smoothBands,
  type Bands,
  type VisualizerStyle,
  type WebglSetup,
} from "@/lib/ui/visualizer";
import { FALLBACK_COLORS, VERTEX_SHADER, fragmentShader } from "./visualizer-shaders";

const RESOLUTION_SCALE = 0.5;
const MAX_DPR = 2;
const CALM_FRAME_MS = 33;
const GRAIN_TILE = 160;

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

type Renderer = {
  resize: (width: number, height: number) => void;
  draw: (time: number, pulse: number, shimmer: number, mid: number) => void;
  dispose: () => void;
};

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  return null;
}

function webglRenderer(canvas: HTMLCanvasElement, style: VisualizerStyle): Renderer | Exclude<WebglSetup, "ready"> {
  const gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, powerPreference: "low-power" });
  if (!gl) return "no-context";
  const fail = (): "failed" => {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return "failed";
  };
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentShader(style));
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return fail();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return fail();
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const resolution = gl.getUniformLocation(program, "u_resolution");
  const time = gl.getUniformLocation(program, "u_time");
  const pulse = gl.getUniformLocation(program, "u_pulse");
  const shimmer = gl.getUniformLocation(program, "u_shimmer");
  const mid = gl.getUniformLocation(program, "u_mid");

  return {
    resize(width, height) {
      gl.viewport(0, 0, width, height);
      gl.uniform2f(resolution, width, height);
    },
    draw(t, p, sh, m) {
      gl.uniform1f(time, t);
      gl.uniform1f(pulse, p);
      gl.uniform1f(shimmer, sh);
      gl.uniform1f(mid, m);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}

function canvasRenderer(canvas: HTMLCanvasElement, style: VisualizerStyle): Renderer | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const [inner, outer] = FALLBACK_COLORS[style];
  let width = 0;
  let height = 0;
  return {
    resize(w, h) {
      width = w;
      height = h;
    },
    draw(t, p) {
      const radius = Math.max(width, height) * (0.35 + p * 0.25);
      const x = width / 2 + Math.sin(t * 0.4) * width * 0.08;
      const y = height / 2 + Math.cos(t * 0.3) * height * 0.06;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, inner);
      gradient.addColorStop(1, outer);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 0.5 + p * 0.5;
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
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
  const loop = useRef<{ start: () => void; stop: () => void } | null>(null);

  useEffect(() => {
    playingRef.current = playing;
    if (playing) loop.current?.start();
    else loop.current?.stop();
  }, [playing]);

  useEffect(() => {
    if (grainRef.current) grainRef.current.style.backgroundImage = grainUrl();
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let canvas = mountCanvas(host);
    const attempt = webglRenderer(canvas, style);
    const plan = canvasFallback(typeof attempt === "string" ? attempt : "ready");
    if (plan === "fresh-canvas") {
      canvas.remove();
      canvas = mountCanvas(host);
    }
    let renderer: Renderer | null = typeof attempt === "string" ? canvasRenderer(canvas, style) : attempt;
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
    let frequencies: Uint8Array<ArrayBuffer> | null = null;
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
      } else {
        target.bass = 0;
        target.mid = 0;
        target.high = 0;
      }
      smoothBands(smoothed, target, elapsed);
      clock += (elapsed / 1000) * flowSpeed(smoothed.mid, reducedMotion);
      renderer?.draw(clock, reducedMotion ? 0 : smoothed.bass, reducedMotion ? 0 : smoothed.high, reducedMotion ? 0 : smoothed.mid);
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
      const restored = webglRenderer(canvas, style);
      renderer = typeof restored === "string" ? null : restored;
      resize();
      start();
    };
    loop.current = { start, stop };
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
  }, [analyser, style, reducedMotion]);

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
