"use client";

import { Pause, Play } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useSound } from "@/components/sound-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { formatDuration } from "@/lib/game/audio-file";
import { registerMedia } from "@/lib/ui/audio-unlock";
import {
  classifyGesture,
  keyStep,
  moveEnd,
  moveStart,
  msAtFraction,
  playbackStopMs,
  previewShouldStop,
  shiftClip,
  trimmerHit,
  type ClipLimits,
  type ClipWindow,
  type Gesture,
  type PlaybackMode,
  type TrimmerHit,
} from "@/lib/ui/clip-window";
import { notifyError } from "@/lib/ui/notify";
import { Waveform } from "./waveform";
import { connectMedia, setGraphBoost, setMediaLevel, type MediaGraph } from "@/lib/ui/audio-graph";

type Press = {
  hit: TrimmerHit;
  pointerType: string;
  x: number;
  at: number;
  originMs: number;
  origin: ClipWindow;
  gesture: Gesture;
  resumePreview: boolean;
};

function useClipPlayer(url: string | null, clip: ClipWindow, durationMs: number, boostDb: number) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const graphRef = useRef<MediaGraph | null>(null);
  const clipRef = useRef(clip);
  const sessionRef = useRef<{ mode: PlaybackMode; fromMs: number } | null>(null);
  const [mode, setMode] = useState<PlaybackMode | null>(null);
  const [positionMs, setPositionMs] = useState<number | null>(null);
  const { gain, muted } = useSound();

  useEffect(() => {
    clipRef.current = clip;
  }, [clip]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    graphRef.current = connectMedia(audio);
    return registerMedia(audio);
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setMediaLevel(audio, graphRef.current, gain, muted);
  }, [gain, muted, url]);

  useEffect(() => {
    if (graphRef.current) setGraphBoost(graphRef.current, boostDb);
  }, [boostDb]);

  useEffect(() => {
    if (!mode) return;
    let frame = 0;
    const tick = () => {
      const audio = audioRef.current;
      const session = sessionRef.current;
      if (!audio || !session) return;
      const ms = audio.currentTime * 1000;
      const stopAt = playbackStopMs(session.mode, session.fromMs, clipRef.current, durationMs);
      if (ms >= stopAt || (session.mode === "selection" && previewShouldStop(ms, clipRef.current))) {
        audio.pause();
        return;
      }
      setPositionMs(ms);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [mode, durationMs]);

  function playFrom(next: PlaybackMode, fromMs: number) {
    const audio = audioRef.current;
    if (!audio || !url) return;
    sessionRef.current = { mode: next, fromMs };
    audio.currentTime = fromMs / 1000;
    setPositionMs(fromMs);
    setMode(next);
    if (!audio.paused) return;
    audio.play().catch((error: unknown) => {
      sessionRef.current = null;
      setMode(null);
      setPositionMs(null);
      notifyError(error, "Couldn't play your track.");
    });
  }

  function cue(ms: number) {
    audioRef.current?.pause();
    setPositionMs(ms);
  }

  function stop() {
    audioRef.current?.pause();
  }

  const reset = () => {
    sessionRef.current = null;
    setMode(null);
  };

  const audioProps = {
    ref: audioRef,
    crossOrigin: "anonymous" as const,
    src: url ?? undefined,
    preload: "metadata" as const,
    onPause: reset,
    onEnded: () => {
      reset();
      setPositionMs(null);
    },
  };

  return { audioProps, mode, positionMs, playFrom, cue, stop };
}

export function ClipTrimmer({
  url,
  peaks,
  limits,
  value,
  onChange,
  disabled = false,
  boostDb = 0,
  waveScale = 1,
  aside,
}: {
  url: string | null;
  peaks: number[] | null;
  limits: ClipLimits;
  value: ClipWindow;
  onChange: (next: ClipWindow) => void;
  disabled?: boolean;
  boostDb?: number;
  waveScale?: number;
  aside?: ReactNode;
}) {
  const [press, setPress] = useState<Press | null>(null);
  const [hover, setHover] = useState<{ fraction: number; hit: TrimmerHit } | null>(null);
  const player = useClipPlayer(url, value, limits.durationMs, boostDb);
  const hintId = useId();
  const total = limits.durationMs || 1;
  const startPct = (value.startMs / total) * 100;
  const endPct = (value.endMs / total) * 100;
  const lengthMs = value.endMs - value.startMs;
  const resizable = limits.minMs < limits.durationMs;
  const editable = !disabled && resizable;
  const activeHit = press?.hit ?? hover?.hit ?? null;
  const showHover = hover !== null && (hover.hit === "outside" || hover.hit === "window") && (press === null || press.gesture === "pending") && url !== null;
  const hoverFraction = Math.min(1, Math.max(0, hover?.fraction ?? 0));
  const pressing = press !== null;

  useEffect(() => {
    if (!pressing) return;
    const endPress = () => setPress(null);
    window.addEventListener("blur", endPress);
    return () => window.removeEventListener("blur", endPress);
  }, [pressing]);

  function locate(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const fraction = rect.width > 0 ? x / rect.width : 0;
    return { x, fraction, ms: msAtFraction(fraction, limits.durationMs), hit: trimmerHit(x, rect.width, value, limits.durationMs, editable) };
  }

  function resize(current: Press, toMs: number) {
    const next =
      current.hit === "start"
        ? moveStart(current.origin, toMs, limits)
        : current.hit === "end"
          ? moveEnd(current.origin, toMs, limits)
          : shiftClip(current.origin, toMs - current.originMs, limits);
    if (next.startMs !== value.startMs || next.endMs !== value.endMs) onChange(next);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const { x, ms, hit } = locate(event);
    if (hit === "outside" && !url) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setPress({
      hit,
      pointerType: event.pointerType,
      x,
      at: event.timeStamp,
      originMs: ms,
      origin: value,
      gesture: classifyGesture({ hit, distancePx: 0, elapsedMs: 0, pointerType: event.pointerType, released: false }),
      resumePreview: player.mode === "selection",
    });
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const { x, fraction, ms, hit } = locate(event);
    if (event.pointerType === "mouse") setHover({ fraction, hit });
    if (!press) return;
    if (event.buttons === 0) return endPress();
    const gesture = classifyGesture({
      hit: press.hit,
      distancePx: Math.abs(x - press.x),
      elapsedMs: event.timeStamp - press.at,
      pointerType: press.pointerType,
      released: false,
    });
    if (gesture !== press.gesture) {
      if (gesture === "move" || gesture === "resize") player.stop();
      setPress({ ...press, gesture });
    }
    if (gesture === "move" || gesture === "resize") resize(press, ms);
    else if (gesture === "scrub") player.cue(ms);
  }

  function endPress() {
    setPress(null);
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!press) return;
    const { x, ms } = locate(event);
    const gesture = classifyGesture({
      hit: press.hit,
      distancePx: Math.abs(x - press.x),
      elapsedMs: event.timeStamp - press.at,
      pointerType: press.pointerType,
      released: true,
    });
    setPress(null);
    if (gesture === "seek" || gesture === "scrub") player.playFrom("free", ms);
    else if (gesture === "move" && press.resumePreview) player.playFrom("selection", shiftClip(press.origin, ms - press.originMs, limits).startMs);
  }

  function onKey(kind: "start" | "end" | "window") {
    return (event: KeyboardEvent<HTMLElement>) => {
      if (!editable) return;
      const step = keyStep(event.key, event.shiftKey);
      if (step === null) return;
      event.preventDefault();
      const next = kind === "start" ? moveStart(value, value.startMs + step, limits) : kind === "end" ? moveEnd(value, value.endMs + step, limits) : shiftClip(value, step, limits);
      if (next.startMs !== value.startMs || next.endMs !== value.endMs) onChange(next);
    };
  }

  const cursor =
    activeHit === "start" || activeHit === "end"
      ? "cursor-ew-resize"
      : activeHit === "window"
        ? press?.gesture === "move"
          ? "cursor-grabbing"
          : "cursor-grab"
        : url
          ? "cursor-pointer"
          : "cursor-default";

  const sliderProps = (kind: "start" | "end" | "window") => ({
    role: "slider" as const,
    tabIndex: editable ? 0 : -1,
    "aria-disabled": !editable || undefined,
    "aria-describedby": hintId,
    onKeyDown: onKey(kind),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end text-xs text-muted tabular-nums">
        <span>
          <span className="font-semibold text-fg">{formatDuration(lengthMs)}</span>
          {limits.maxMs < limits.durationMs && <> of {formatDuration(limits.maxMs)} max</>}
        </span>
      </div>

      <div
        className={cn("relative h-24 touch-none select-none sm:h-28", cursor)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={endPress}
        onLostPointerCapture={endPress}
        onPointerLeave={() => setHover(null)}
      >
        <div className="relative h-full transition-transform duration-200 ease-out motion-reduce:transition-none" style={{ transform: `scaleY(${waveScale})` }}>
          <Waveform peaks={peaks} progress={0} className="h-full" />
          <div aria-hidden className="pointer-events-none absolute inset-0" style={{ clipPath: `inset(0 ${100 - endPct}% 0 ${startPct}%)` }}>
            <Waveform peaks={peaks} progress={1} className="h-full" />
          </div>
        </div>

        <div
          {...sliderProps("window")}
          aria-label="Clip position"
          aria-valuemin={0}
          aria-valuemax={Math.round((limits.durationMs - lengthMs) / 1000)}
          aria-valuenow={Math.round(value.startMs / 1000)}
          aria-valuetext={`${formatDuration(value.startMs)} to ${formatDuration(value.endMs)}`}
          className={cn(
            "pointer-events-none absolute inset-y-0 rounded-lg border-2 border-fg/80 outline-none transition-colors duration-150 ease-snappy focus-visible:ring-2 focus-visible:ring-fg/60",
            press?.gesture === "move" && "border-fg",
            disabled && "border-fg/40",
          )}
          style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}
        />

        {resizable &&
          (["start", "end"] as const).map((kind) => {
            const pct = kind === "start" ? startPct : endPct;
            const ms = kind === "start" ? value.startMs : value.endMs;
            return (
              <div
                key={kind}
                {...sliderProps(kind)}
                aria-label={kind === "start" ? "Clip start" : "Clip end"}
                aria-valuemin={0}
                aria-valuemax={Math.round(limits.durationMs / 1000)}
                aria-valuenow={Math.round(ms / 1000)}
                aria-valuetext={formatDuration(ms)}
                className="pointer-events-none absolute inset-y-0 z-20 flex w-5 -translate-x-1/2 items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-fg/60"
                style={{ left: `${pct}%` }}
              >
                <span
                  className={cn(
                    "h-[70%] w-1.5 rounded-full bg-fg shadow-[0_0_0_3px_rgba(10,10,10,0.9)] transition-transform duration-150 ease-snappy",
                    activeHit === kind && editable && "scale-y-110",
                    disabled && "bg-fg/50",
                  )}
                />
              </div>
            );
          })}

        {player.positionMs !== null && (
          <span aria-hidden className="pointer-events-none absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 bg-fg" style={{ left: `${(player.positionMs / total) * 100}%` }} />
        )}

        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-0 z-10 w-px bg-fg/60 transition-opacity duration-150 ease-snappy",
            showHover ? "opacity-100" : "opacity-0",
          )}
          style={{ left: `${hoverFraction * 100}%` }}
        >
          <span className="absolute -top-6 left-1/2 -translate-x-1/2 rounded bg-raised px-1.5 py-0.5 text-[11px] font-semibold text-fg tabular-nums">
            {formatDuration(hoverFraction * limits.durationMs)}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => (player.mode ? player.stop() : player.playFrom("selection", value.startMs))}
          disabled={!url}
        >
          {player.mode ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {player.mode ? "Stop" : "Preview clip"}
        </Button>
        {aside}
      </div>
      <span id={hintId} className="sr-only">
        Arrow keys move by 1 second, Shift with an arrow key moves by 5 seconds. Click the waveform to play from that point.
      </span>
      <audio {...player.audioProps} className="hidden" />
    </div>
  );
}
