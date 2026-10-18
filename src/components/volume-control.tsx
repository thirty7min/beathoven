"use client";

import { Volume1, Volume2, VolumeX } from "lucide-react";
import { useEffect, useReducer, useRef, useState, type FocusEvent } from "react";
import { REVEAL_LEAVE_DELAY_MS, REVEAL_TOUCH_IDLE_MS, initialRevealState, isRevealed, revealReducer } from "@/lib/ui/volume-reveal";
import { cn } from "./ui/cn";
import { useSound } from "./sound-provider";

export function VolumeControl({ className }: { className?: string }) {
  const { muted, volume, toggleMuted, setVolume } = useSound();
  const [state, dispatch] = useReducer(revealReducer, initialRevealState);
  const [touchActivity, setTouchActivity] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const leaveTimer = useRef<number | null>(null);
  const pointerType = useRef<string>("mouse");
  const open = isRevealed(state);

  function cancelLeave() {
    if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
    leaveTimer.current = null;
  }

  useEffect(() => cancelLeave, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node && rootRef.current?.contains(e.target))) dispatch({ type: "outside" });
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  useEffect(() => {
    if (!state.dragging) return;
    const end = () => dispatch({ type: "dragEnd" });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [state.dragging]);

  useEffect(() => {
    if (!state.touch) return;
    const timer = window.setTimeout(() => dispatch({ type: "idle" }), REVEAL_TOUCH_IDLE_MS);
    return () => window.clearTimeout(timer);
  }, [state.touch, state.dragging, touchActivity]);

  function onIconClick() {
    if (pointerType.current === "touch" && !open) {
      dispatch({ type: "touchOpen" });
      return;
    }
    toggleMuted();
  }

  function onFocus(e: FocusEvent<HTMLDivElement>) {
    if (e.target.matches(":focus-visible")) dispatch({ type: "keyboardFocus" });
  }

  function onBlur(e: FocusEvent<HTMLDivElement>) {
    if (!(e.relatedTarget instanceof Node && rootRef.current?.contains(e.relatedTarget))) dispatch({ type: "blur" });
  }

  const Icon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div
      ref={rootRef}
      data-open={open}
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse") return;
        cancelLeave();
        dispatch({ type: "hover" });
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "mouse") return;
        cancelLeave();
        leaveTimer.current = window.setTimeout(() => dispatch({ type: "hoverEnd" }), REVEAL_LEAVE_DELAY_MS);
      }}
      onFocus={onFocus}
      onBlur={onBlur}
      className={cn("group relative flex items-center", className)}
    >
      <div
        className={cn(
          "absolute right-full mr-1 flex h-9 items-center rounded-full border border-line-strong bg-surface px-3 opacity-0 transition-[clip-path,opacity] duration-200 ease-snappy [clip-path:inset(0_0_0_100%_round_9999px)]",
          "group-data-[open=true]:opacity-100 group-data-[open=true]:[clip-path:inset(0_round_9999px)]",
          !open && "pointer-events-none",
          "motion-reduce:transition-opacity",
        )}
      >
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={muted ? 0 : volume}
          onPointerDown={() => dispatch({ type: "dragStart" })}
          onChange={(e) => {
            setVolume(Number(e.target.value));
            setTouchActivity((n) => n + 1);
          }}
          aria-label="Volume"
          className="w-24"
        />
      </div>
      <button
        onPointerDown={(e) => {
          pointerType.current = e.pointerType;
        }}
        onClick={onIconClick}
        aria-label={muted ? "Unmute sound" : "Mute sound"}
        aria-pressed={muted}
        className="flex h-9 w-9 items-center justify-center rounded-full text-muted transition-[transform,background-color,color] duration-150 ease-snappy hover:bg-white/[0.06] hover:text-fg active:scale-[0.97]"
      >
        <Icon className="h-[18px] w-[18px]" />
      </button>
    </div>
  );
}
