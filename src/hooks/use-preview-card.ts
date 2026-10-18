"use client";

import { useRef, type MouseEvent, type PointerEvent } from "react";

type PreviewActions = {
  enter: (url: string, limitMs: number | null, startMs: number) => void;
  leave: () => void;
  tap: (url: string, limitMs: number | null, startMs: number) => void;
};

export function usePreviewCard(url: string | null, limitMs: number | null, startMs: number, actions: PreviewActions) {
  const pointer = useRef("mouse");
  return {
    onPointerDown: (e: PointerEvent) => {
      pointer.current = e.pointerType;
    },
    onPointerEnter: (e: PointerEvent) => {
      if (e.pointerType === "mouse" && url) actions.enter(url, limitMs, startMs);
    },
    onPointerLeave: (e: PointerEvent) => {
      if (e.pointerType === "mouse") actions.leave();
    },
    onClick: (e: MouseEvent) => {
      if (pointer.current !== "mouse" && url && !(e.target instanceof Element && e.target.closest("button"))) actions.tap(url, limitMs, startMs);
    },
  };
}
