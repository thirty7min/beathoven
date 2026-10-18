"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { formatDuration } from "@/lib/game/audio-file";
import { seekPosition } from "@/lib/game/playback-sync";
import { BAR_GAP_PX, BAR_WIDTH_PX, MIN_BAR_HEIGHT, barCount, playedBars, resampleHeights } from "@/lib/game/waveform";

function barTone(index: number, played: number, preview: number | null): string {
  if (preview !== null && index >= Math.min(played, preview) && index < Math.max(played, preview)) {
    return index < played ? "bg-white/60" : "bg-white/35";
  }
  return index < played ? "bg-fg" : "bg-white/15";
}

export function Waveform({
  peaks,
  progress,
  preview = null,
  className,
}: {
  peaks: number[] | null;
  progress: number;
  preview?: number | null;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const bars = useMemo(() => (peaks ? resampleHeights(peaks, barCount(width)) : null), [peaks, width]);
  const total = bars?.length ?? 0;
  const played = playedBars(total, progress);
  const previewBar = preview === null ? null : playedBars(total, preview);
  const clamped = Math.min(1, Math.max(0, progress));

  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={box}
      role="progressbar"
      aria-label="Track progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      className={cn("relative flex w-full items-center", className ?? "h-24 sm:h-28")}
      style={{ gap: BAR_GAP_PX }}
    >
      {bars ? (
        bars.map((height, i) => (
          <span
            key={i}
            className={cn("shrink-0 rounded-full transition-colors duration-150", barTone(i, played, previewBar))}
            style={{ width: BAR_WIDTH_PX, height: `${Math.max(MIN_BAR_HEIGHT, height) * 100}%` }}
          />
        ))
      ) : (
        <>
          <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 animate-pulse rounded-full bg-white/10" />
          <span
            className="absolute inset-x-0 top-1/2 h-1 origin-left -translate-y-1/2 rounded-full bg-fg transition-transform duration-200 ease-linear"
            style={{ transform: `scaleX(${clamped})` }}
          />
        </>
      )}
    </div>
  );
}

const KEY_STEP_MS = 5_000;

function fractionAt(event: MouseEvent<HTMLElement>): number {
  const rect = event.currentTarget.getBoundingClientRect();
  return rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
}

export function SeekableWaveform({
  peaks,
  progress,
  clipMs,
  onSeek,
  label = "Seek",
  className,
  waveClassName,
  children,
}: {
  peaks: number[] | null;
  progress: number;
  clipMs: number | null;
  onSeek: ((ms: number) => void) | null;
  label?: string;
  className?: string;
  waveClassName?: string;
  children?: ReactNode;
}) {
  const [hover, setHover] = useState<{ fraction: number; visible: boolean }>({ fraction: 0, visible: false });
  const active = onSeek !== null && clipMs !== null && clipMs > 0;
  const showing = active && hover.visible;
  const fraction = Math.min(1, Math.max(0, hover.fraction));
  const positionMs = Math.min(1, Math.max(0, progress)) * (clipMs ?? 0);

  return (
    <div
      role={active ? "slider" : undefined}
      tabIndex={active ? 0 : undefined}
      aria-label={active ? label : undefined}
      aria-valuemin={active ? 0 : undefined}
      aria-valuemax={active ? Math.round((clipMs ?? 0) / 1000) : undefined}
      aria-valuenow={active ? Math.round(positionMs / 1000) : undefined}
      aria-valuetext={active ? formatDuration(positionMs) : undefined}
      className={cn("relative rounded-md focus-visible:outline focus-visible:outline-offset-4 focus-visible:outline-fg/40", active && "cursor-pointer", className)}
      onPointerMove={(e: PointerEvent<HTMLDivElement>) => {
        if (active && e.pointerType === "mouse") setHover({ fraction: fractionAt(e), visible: true });
      }}
      onPointerLeave={() => setHover((h) => ({ ...h, visible: false }))}
      onClick={(e) => {
        if (!active) return;
        e.stopPropagation();
        onSeek(seekPosition(fractionAt(e), clipMs));
      }}
      onKeyDown={(e) => {
        if (!active) return;
        const step = e.key === "ArrowRight" ? KEY_STEP_MS : e.key === "ArrowLeft" ? -KEY_STEP_MS : 0;
        if (!step) return;
        e.preventDefault();
        e.stopPropagation();
        onSeek(Math.min(clipMs, Math.max(0, positionMs + step)));
      }}
    >
      <Waveform peaks={peaks} progress={progress} preview={showing ? fraction : null} className={waveClassName} />
      {children}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 w-px bg-fg/70 transition-opacity duration-150 ease-snappy",
          showing ? "opacity-100" : "opacity-0",
        )}
        style={{ left: `${fraction * 100}%` }}
      >
        <span className="absolute -top-6 left-1/2 -translate-x-1/2 rounded bg-raised px-1.5 py-0.5 text-[11px] font-semibold text-fg tabular-nums">
          {formatDuration(fraction * (clipMs ?? 0))}
        </span>
      </div>
    </div>
  );
}
