"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  FIRE_BOX,
  FLAME_PALETTE,
  GLOW_ALPHA,
  GLOW_COLOR,
  NOISE_OCTAVES,
  RESTORE_TIMEOUT_MS,
  SMOKE_COLOR,
  STILL_PHASE,
  advancePhase,
  approachLevel,
  badgeEdge,
  coronaLength,
  createFlameShape,
  fireBoxStyle,
  fireBufferSize,
  fireMounted,
  flameLevel,
  flameShape,
  isCold,
  type FlameLevel,
} from "@/lib/ui/flames";
import { FIRE_CONTEXT, createFireRenderer, supportsFireShader, type FireFrame, type FireRenderer } from "./fire-gl";

const BOX_STYLE = fireBoxStyle();
const FULL_FLAME = flameShape(flameLevel(5).fire);
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function readReducedMotion() {
  return window.matchMedia(REDUCED_MOTION).matches;
}

function subscribeNever() {
  return () => {};
}

export function Flames({ score, children }: { score: number | null; children: ReactNode }) {
  const level = flameLevel(score);
  const still = useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => false);
  const supported = useSyncExternalStore(subscribeNever, supportsFireShader, () => true);
  const [failed, setFailed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const webgl = supported && !failed;
  const show = fireMounted(level, mounted, webgl && !still);
  if (show !== mounted) setMounted(show);

  return (
    <div className="relative size-full">
      {show && !webgl && <FireFallback level={level} still={still} />}
      {children}
      {show && webgl && <FireCanvas level={level} still={still} onCold={() => setMounted(false)} onFail={() => setFailed(true)} />}
    </div>
  );
}

type FireCanvasProps = { level: FlameLevel; still: boolean; onCold: () => void; onFail: () => void };

function FireCanvas({ level, still, onCold, onFail }: FireCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const target = useRef(level);
  const wake = useRef(() => {});
  const handlers = useRef({ onCold, onFail });

  useEffect(() => {
    handlers.current = { onCold, onFail };
  });

  useEffect(() => {
    target.current = level;
    wake.current();
  }, [level]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const canvas = document.createElement("canvas");
    canvas.className = "absolute inset-0 size-full invisible";
    host.append(canvas);
    const gl = canvas.getContext("webgl", FIRE_CONTEXT);
    let renderer: FireRenderer | null = gl && createFireRenderer(gl);
    if (!gl || !renderer) {
      canvas.remove();
      handlers.current.onFail();
      return;
    }

    const current: FlameLevel = still ? { ...target.current, embers: 0 } : { fire: 0, smoke: 0, embers: 0 };
    const frame: FireFrame = { phase: STILL_PHASE, level: current, shape: createFlameShape(), edge: badgeEdge(0, 0) };
    let raf = 0;
    let last = 0;
    let onScreen = false;
    let restoreTimer = 0;

    function render(now: number) {
      raf = 0;
      if (!renderer) return;
      const dt = last ? Math.min(now - last, 100) : 16;
      last = now;
      if (still) {
        Object.assign(current, target.current, { embers: 0 });
      } else {
        approachLevel(current, target.current, dt);
        frame.phase = advancePhase(frame.phase, dt, frame.shape.speed);
      }
      flameShape(current.fire, frame.shape);
      if (isCold(current)) {
        renderer.clear();
        canvas.classList.add("invisible");
        last = 0;
        handlers.current.onCold();
        return;
      }
      renderer.draw(frame);
      canvas.classList.remove("invisible");
      if (!still) schedule();
    }

    function schedule() {
      if (raf || !renderer || !onScreen || document.hidden) {
        if (!raf) last = 0;
        return;
      }
      raf = requestAnimationFrame(render);
    }

    function stop() {
      cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
    }

    const resize = new ResizeObserver(([entry]) => {
      const size = fireBufferSize(entry.contentRect.width, entry.contentRect.height, window.devicePixelRatio);
      if (canvas.width === size.width && canvas.height === size.height) return;
      canvas.width = size.width;
      canvas.height = size.height;
      frame.edge = badgeEdge(entry.contentRect.width, size.width);
      stop();
      schedule();
    });
    const visibility = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      if (onScreen) schedule();
      else stop();
    });
    const onPageVisibility = () => (document.hidden ? stop() : schedule());
    const onLost = (e: Event) => {
      e.preventDefault();
      stop();
      renderer = null;
      canvas.classList.add("invisible");
      restoreTimer = window.setTimeout(() => handlers.current.onFail(), RESTORE_TIMEOUT_MS);
    };
    const onRestored = () => {
      window.clearTimeout(restoreTimer);
      renderer = createFireRenderer(gl);
      if (renderer) schedule();
      else handlers.current.onFail();
    };

    resize.observe(host);
    visibility.observe(host);
    document.addEventListener("visibilitychange", onPageVisibility);
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    wake.current = schedule;

    return () => {
      wake.current = () => {};
      stop();
      window.clearTimeout(restoreTimer);
      resize.disconnect();
      visibility.disconnect();
      document.removeEventListener("visibilitychange", onPageVisibility);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      renderer?.dispose();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    };
  }, [still]);

  return <div ref={hostRef} aria-hidden className="pointer-events-none absolute" style={BOX_STYLE} />;
}

const FALLBACK_LAYERS = [
  { color: FLAME_PALETTE[0], scale: 1 },
  { color: FLAME_PALETTE[1], scale: 0.72 },
  { color: FLAME_PALETTE[2], scale: 0.48 },
  { color: FLAME_PALETTE[3], scale: 0.28 },
];

const FALLBACK_TONGUES = 9;

function coronaPath(scale: number) {
  const points = Array.from({ length: 96 }, (_, i) => {
    const angle = (i / 96) * Math.PI * 2;
    const tongue = 0.8 + 0.2 * Math.cos(FALLBACK_TONGUES * angle);
    const radius = 1 + coronaLength(FULL_FLAME, Math.sin(angle)) * scale * tongue;
    return `${(radius * Math.cos(angle)).toFixed(3)} ${(-radius * Math.sin(angle)).toFixed(3)}`;
  });
  return `M ${points.join(" L ")} Z`;
}

const FALLBACK_PATHS = FALLBACK_LAYERS.map((layer) => ({ color: layer.color, d: coronaPath(layer.scale) }));

function FireFallback({ level, still }: { level: FlameLevel; still: boolean }) {
  const id = useId();
  const shape = flameShape(level.fire);
  const scale = (1 + shape.height) / (1 + FULL_FLAME.height);

  return (
    <svg
      aria-hidden
      viewBox={`${FIRE_BOX.left} ${-FIRE_BOX.top} ${FIRE_BOX.right - FIRE_BOX.left} ${FIRE_BOX.top - FIRE_BOX.bottom}`}
      className="pointer-events-none absolute overflow-visible"
      style={BOX_STYLE}
    >
      <defs>
        <radialGradient id={`${id}-glow`} gradientUnits="userSpaceOnUse" cx="0" cy="-0.2" r="1.7">
          <stop offset="0.55" stopColor={GLOW_COLOR} stopOpacity={GLOW_ALPHA * 2} />
          <stop offset="0.8" stopColor={GLOW_COLOR} stopOpacity={GLOW_ALPHA} />
          <stop offset="1" stopColor={GLOW_COLOR} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-smoke`}>
          <stop offset="0.5" stopColor={SMOKE_COLOR} stopOpacity="0.5" />
          <stop offset="1" stopColor={SMOKE_COLOR} stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}-turbulence`} x="-50%" y="-50%" width="200%" height="200%">
          <feTurbulence type="fractalNoise" baseFrequency="0.7 0.35" numOctaves={NOISE_OCTAVES - 1} seed="4" result="noise">
            {!still && <animate attributeName="baseFrequency" dur="1.6s" values="0.7 0.35;0.85 0.45;0.65 0.4;0.7 0.35" repeatCount="indefinite" />}
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="0.5" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
      <circle
        cx="0"
        cy="-0.2"
        r="1.7"
        fill={`url(#${id}-glow)`}
        className="transition-opacity duration-300 ease-snappy"
        style={{ opacity: shape.glow }}
      />
      <g
        filter={`url(#${id}-turbulence)`}
        className="transition-[transform,opacity] duration-300 ease-snappy motion-reduce:transition-none"
        style={{ opacity: shape.opacity, transform: `scale(${scale})`, transformOrigin: "0 0" }}
      >
        {FALLBACK_PATHS.map((layer) => (
          <path key={layer.color} fill={layer.color} d={layer.d} />
        ))}
      </g>
      <g className="transition-opacity duration-300 ease-snappy" style={{ opacity: level.smoke }}>
        <circle cx="0.12" cy="-1.4" r="0.3" fill={`url(#${id}-smoke)`} />
        <circle cx="-0.08" cy="-1.95" r="0.4" fill={`url(#${id}-smoke)`} />
      </g>
    </svg>
  );
}
