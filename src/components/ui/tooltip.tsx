"use client";

import { useEffect, useId, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "./cn";

const OPEN_DELAY_MS = 300;
const INSTANT_WINDOW_MS = 400;
let lastClosedAt = 0;

type Placement = { left: number; top?: number; bottom?: number; below: boolean; instant: boolean };

export function Tooltip({
  content,
  children,
  focusable = true,
  className,
}: {
  content: ReactNode;
  children: ReactNode;
  focusable?: boolean;
  className?: string;
}) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | null>(null);
  const pointer = useRef("mouse");
  const [placement, setPlacement] = useState<Placement | null>(null);
  const id = useId();

  function clearTimer() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }

  function place(instant: boolean) {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const below = rect.top < 140;
    setPlacement({
      left: rect.left + rect.width / 2,
      top: below ? rect.bottom + 8 : undefined,
      bottom: below ? undefined : window.innerHeight - rect.top + 8,
      below,
      instant,
    });
  }

  function show(immediate: boolean) {
    clearTimer();
    const instant = performance.now() - lastClosedAt < INSTANT_WINDOW_MS;
    if (immediate || instant) place(instant);
    else timer.current = window.setTimeout(() => place(false), OPEN_DELAY_MS);
  }

  function hide() {
    clearTimer();
    setPlacement((current) => {
      if (current) lastClosedAt = performance.now();
      return null;
    });
  }

  useEffect(() => clearTimer, []);

  useEffect(() => {
    if (!placement) return;
    const close = () => setPlacement(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onDown = (e: globalThis.PointerEvent) => {
      if (!(e.target instanceof Node && triggerRef.current?.contains(e.target))) close();
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [placement]);

  function onClick(e: MouseEvent) {
    if (pointer.current === "mouse") return;
    e.preventDefault();
    e.stopPropagation();
    if (placement) hide();
    else show(true);
  }

  return (
    <>
      <span
        ref={triggerRef}
        tabIndex={focusable ? 0 : undefined}
        aria-describedby={placement ? id : undefined}
        onPointerDown={(e: PointerEvent) => {
          pointer.current = e.pointerType;
        }}
        onPointerEnter={(e) => e.pointerType === "mouse" && show(false)}
        onPointerLeave={(e) => e.pointerType === "mouse" && hide()}
        onFocus={() => show(true)}
        onBlur={hide}
        onClickCapture={focusable ? onClick : undefined}
        className={cn("inline-flex rounded-md focus-visible:outline focus-visible:outline-offset-2 focus-visible:outline-fg/40", className)}
      >
        {children}
      </span>
      {placement &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            style={{ left: placement.left, top: placement.top, bottom: placement.bottom, transformOrigin: placement.below ? "top center" : "bottom center" }}
            className={cn(
              "pointer-events-none fixed z-[70] max-w-64 -translate-x-1/2 rounded-lg border border-line-strong bg-raised px-3 py-2 text-xs leading-relaxed text-muted shadow-2xl",
              !placement.instant && "animate-tooltip",
            )}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
