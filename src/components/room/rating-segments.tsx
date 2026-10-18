"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { MAX_SCORE, MIN_SCORE, scoreFromKey } from "@/lib/game/dial";
import { SCORE_LABELS } from "@/lib/game/voting";

const GROUP_CLASSES = "flex rounded-full border border-line-strong p-0.5";
const SCORES = Array.from({ length: MAX_SCORE - MIN_SCORE + 1 }, (_, i) => MIN_SCORE + i);

export function RatingSegments({
  score,
  disabled = false,
  label,
  onRate,
}: {
  score: number;
  disabled?: boolean;
  label: string;
  onRate: (score: number) => void;
}) {
  const group = useRef<HTMLDivElement>(null);

  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const next = scoreFromKey(event.key, score);
    if (next === null) return;
    event.preventDefault();
    if (next !== score) onRate(next);
    group.current?.querySelector<HTMLButtonElement>(`[data-score="${next}"]`)?.focus();
  }

  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      onKeyDown={onKey}
      className={cn(GROUP_CLASSES, disabled && "opacity-40")}
    >
      {SCORES.map((value) => {
        const selected = value === score;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            data-score={value}
            aria-checked={selected}
            aria-label={`${value} – ${SCORE_LABELS[value]}`}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => value !== score && onRate(value)}
            className={cn(
              "h-8 w-8 rounded-full text-sm font-bold tabular-nums transition-[background-color,color,transform] duration-150 ease-snappy outline-none focus-visible:ring-2 focus-visible:ring-fg/60 active:scale-[0.94] sm:h-9 sm:w-9",
              selected ? "bg-fg text-page" : "text-muted hover:text-fg",
            )}
          >
            {value}
          </button>
        );
      })}
    </div>
  );
}

export function RatingPill({ children }: { children: ReactNode }) {
  return (
    <div className={GROUP_CLASSES}>
      <span className="flex h-8 w-40 items-center justify-center text-sm font-semibold text-muted sm:h-9 sm:w-45">{children}</span>
    </div>
  );
}
