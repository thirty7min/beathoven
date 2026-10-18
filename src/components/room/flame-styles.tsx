"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import { fireBoxStyle } from "@/lib/ui/flames";
import {
  DEFAULT_FLAME_STYLE,
  EMBER_MAX,
  TONGUES,
  chooseFlameStyle,
  emberColor,
  emberRate,
  heatColor,
  heatGlow,
  heatLevel,
  nextFlameStyle,
  spawnEmber,
  stepEmber,
  tongueScale,
  type Ember,
  type FlameStyle,
} from "@/lib/ui/flame-styles";
import { Flames } from "./flames";

type FlameProps = { score: number | null; children: ReactNode };

const STORAGE_KEY = "beathoven:flame-style";
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const MAX_DPR = 2;

const STICKER_BOX = { left: -1.7, right: 1.7, bottom: -0.2, top: 3.3 };
const EMBER_BOX = { left: -2, right: 2, bottom: -0.4, top: 4 };
const HAZE_BOX = { left: -1.2, right: 1.2, bottom: 0, top: 2.6 };

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function useReducedMotion() {
  return useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia(REDUCED_MOTION).matches, () => false);
}

function viewBox(box: { left: number; right: number; bottom: number; top: number }) {
  return `${box.left} ${-box.top} ${box.right - box.left} ${box.top - box.bottom}`;
}

function tongue(width: number, height: number) {
  return `M ${-width} 0 C ${-width} ${-height * 0.45}, ${-width * 0.35} ${-height * 0.55}, ${-width * 0.15} ${-height * 0.78} C ${-width * 0.05} ${-height * 0.9}, ${width * 0.1} ${-height * 0.95}, 0 ${-height} C ${width * 0.55} ${-height * 0.8}, ${width} ${-height * 0.5}, ${width} 0 Z`;
}

const STICKER_LAYERS = [
  { color: "#f0461b", scale: 1 },
  { color: "#ff8a1f", scale: 0.72 },
  { color: "#ffd23f", scale: 0.45 },
];

function StickerFlame({ score, children }: FlameProps) {
  const heat = heatLevel(score);
  const smoky = score !== null && Math.round(score) === 1;

  return (
    <div className="relative size-full">
      <svg aria-hidden viewBox={viewBox(STICKER_BOX)} className="pointer-events-none absolute overflow-visible" style={fireBoxStyle(STICKER_BOX)}>
        {TONGUES.map((t, i) => {
          const scale = tongueScale(heat, t.from);
          return (
            <g key={i} transform={`translate(${t.x} -0.55)`}>
              <g
                className="transition-[transform,opacity] duration-300 ease-snappy motion-reduce:transition-none"
                style={{ transform: `scale(${scale})`, opacity: scale > 0 ? 1 : 0 }}
              >
                <g
                  className="animate-lick motion-reduce:animate-none"
                  style={{ transformBox: "fill-box", transformOrigin: "50% 100%", animationDelay: `${i * -0.37}s`, animationDuration: `${0.9 + i * 0.17}s` }}
                >
                  {STICKER_LAYERS.map((layer, j) => (
                    <path
                      key={layer.color}
                      d={tongue(0.62 * t.width * layer.scale, 2.45 * t.height * layer.scale)}
                      fill={layer.color}
                      stroke={j === 0 ? "#fff4c4" : undefined}
                      strokeWidth={j === 0 ? 0.07 : undefined}
                      strokeLinejoin="round"
                    />
                  ))}
                </g>
              </g>
            </g>
          );
        })}
        <g className="transition-opacity duration-300 ease-snappy" style={{ opacity: smoky ? 1 : 0 }}>
          <g className="animate-puff motion-reduce:animate-none" style={{ transformBox: "fill-box", transformOrigin: "50% 100%" }}>
            <circle cx="-0.12" cy="-1.3" r="0.26" fill="#8c8c8c" />
            <circle cx="0.18" cy="-1.45" r="0.32" fill="#8c8c8c" />
            <circle cx="0.02" cy="-1.85" r="0.22" fill="#8c8c8c" />
          </g>
        </g>
      </svg>
      {children}
    </div>
  );
}

function EmberFlame({ score, children }: FlameProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const still = useReducedMotion();
  const rate = useRef(emberRate(score));
  const heat = useRef(heatLevel(score));
  const wake = useRef(() => {});

  useEffect(() => {
    rate.current = emberRate(score);
    heat.current = heatLevel(score);
    wake.current();
  }, [score]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const canvas = document.createElement("canvas");
    canvas.className = "absolute inset-0 size-full";
    host.append(canvas);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      canvas.remove();
      return;
    }
    const embers: Ember[] = [];
    let raf = 0;
    let last = 0;
    let debt = 0;

    function toPx(x: number, y: number) {
      return [((x - EMBER_BOX.left) / (EMBER_BOX.right - EMBER_BOX.left)) * canvas.width, ((EMBER_BOX.top - y) / (EMBER_BOX.top - EMBER_BOX.bottom)) * canvas.height];
    }

    function paint() {
      const unit = canvas.width / (EMBER_BOX.right - EMBER_BOX.left);
      ctx!.clearRect(0, 0, canvas.width, canvas.height);
      ctx!.globalCompositeOperation = "lighter";
      for (const ember of embers) {
        const progress = ember.age / ember.life;
        const [px, py] = toPx(ember.x, ember.y);
        ctx!.globalAlpha = Math.max(0, 1 - progress * progress);
        ctx!.fillStyle = emberColor(progress);
        ctx!.beginPath();
        ctx!.arc(px, py, Math.max(0.5, ember.size * unit * (1 - progress * 0.5)), 0, Math.PI * 2);
        ctx!.fill();
      }
      ctx!.globalAlpha = 1;
    }

    function paintStill() {
      embers.length = 0;
      const count = Math.round(rate.current / 3);
      let seed = 7;
      const random = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
      for (let i = 0; i < count; i++) {
        const ember = spawnEmber(heat.current, random);
        const age = ember.life * random() * 0.7;
        for (let t = 0; t < age; t += 50) stepEmber(ember, 50);
        embers.push(ember);
      }
      paint();
    }

    function frame(now: number) {
      raf = 0;
      const dt = last ? Math.min(now - last, 100) : 16;
      last = now;
      debt += (rate.current * dt) / 1000;
      while (debt >= 1 && embers.length < EMBER_MAX) {
        embers.push(spawnEmber(heat.current, Math.random));
        debt -= 1;
      }
      if (debt >= 1) debt = 0;
      for (let i = embers.length - 1; i >= 0; i--) if (!stepEmber(embers[i], dt)) embers.splice(i, 1);
      paint();
      if (embers.length > 0 || rate.current > 0) schedule();
      else last = 0;
    }

    function schedule() {
      if (still) {
        paintStill();
        return;
      }
      if (raf || document.hidden) return;
      raf = requestAnimationFrame(frame);
    }

    function stop() {
      cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
    }

    const resize = new ResizeObserver(([entry]) => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      canvas.width = Math.max(1, Math.round(entry.contentRect.width * dpr));
      canvas.height = Math.max(1, Math.round(entry.contentRect.height * dpr));
      if (still) paintStill();
    });
    const onVisibility = () => (document.hidden ? stop() : schedule());
    resize.observe(host);
    document.addEventListener("visibilitychange", onVisibility);
    wake.current = schedule;
    schedule();

    return () => {
      wake.current = () => {};
      stop();
      resize.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.remove();
    };
  }, [still]);

  return (
    <div className="relative size-full">
      <div ref={hostRef} aria-hidden className="pointer-events-none absolute" style={fireBoxStyle(EMBER_BOX)} />
      {children}
    </div>
  );
}

function HeatFlame({ score, children }: FlameProps) {
  const glow = heatGlow(score);
  const color = heatColor(score);
  const hazy = heatLevel(score) >= 0.5;

  return (
    <div
      className="relative size-full transition-[color,text-shadow] duration-300 ease-snappy"
      style={{
        color,
        textShadow: glow > 0 ? `0 0 ${0.08 + glow * 0.14}em ${color}, 0 0 ${0.25 + glow * 0.35}em rgba(255, 122, 26, ${0.25 + glow * 0.35})` : undefined,
      }}
    >
      <svg
        aria-hidden
        viewBox={viewBox(HAZE_BOX)}
        className="pointer-events-none absolute overflow-visible transition-opacity duration-300 ease-snappy"
        style={{ ...fireBoxStyle(HAZE_BOX), opacity: hazy ? glow * 0.5 : 0 }}
      >
        {[-0.45, 0, 0.45].map((x, i) => (
          <path
            key={x}
            d={`M ${x} -1.1 c 0.18 -0.25 -0.18 -0.5 0 -0.75 s -0.18 -0.5 0 -0.75`}
            fill="none"
            stroke={color}
            strokeWidth="0.06"
            strokeLinecap="round"
            className="animate-haze motion-reduce:animate-none"
            style={{ transformBox: "fill-box", animationDelay: `${i * -0.5}s` }}
          />
        ))}
      </svg>
      {children}
    </div>
  );
}

export const FLAME_EFFECTS: Record<FlameStyle, ComponentType<FlameProps>> = {
  classic: Flames,
  sticker: StickerFlame,
  embers: EmberFlame,
  heat: HeatFlame,
};

function loadFlameStyle(): FlameStyle {
  if (typeof window === "undefined") return DEFAULT_FLAME_STYLE;
  try {
    return chooseFlameStyle(new URLSearchParams(window.location.search).get("flame"), window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_FLAME_STYLE;
  }
}

export function useFlameStyle() {
  const [style, setStyle] = useState(loadFlameStyle);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, style);
    } catch {}
  }, [style]);

  return { style, cycle: () => setStyle(nextFlameStyle) };
}
