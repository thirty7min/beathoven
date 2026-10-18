"use client";

import { useId } from "react";
import { cn } from "@/components/ui/cn";
import { canSelectDaw, toggleDaw } from "@/lib/profile/daw-selection";
import { DAWS, MAX_DAWS, type DawSlug } from "@/lib/profile/daws";
import { DawLogo } from "./daw-logo";

export function DawPicker({
  value,
  onChange,
  max = MAX_DAWS,
  label = "DAWs",
  disabled,
}: {
  value: readonly DawSlug[];
  onChange: (value: DawSlug[]) => void;
  max?: number;
  label?: string;
  disabled?: boolean;
}) {
  const labelId = useId();
  const hintId = useId();
  const full = value.length >= max;

  return (
    <div role="group" aria-labelledby={labelId} aria-describedby={hintId} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span id={labelId} className="text-sm font-medium">
          {label}
        </span>
        <span className={cn("text-xs tabular-nums transition-colors duration-150", full ? "text-fg" : "text-muted")}>
          {Math.min(value.length, max)}/{max}
          <span className="sr-only"> selected</span>
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {DAWS.map((daw) => {
          const order = value.indexOf(daw.slug);
          const selected = order !== -1;
          const unavailable = disabled || !canSelectDaw(value, daw.slug, max);
          return (
            <button
              key={daw.slug}
              type="button"
              aria-pressed={selected}
              aria-disabled={unavailable || undefined}
              onClick={() => !unavailable && onChange(toggleDaw(value, daw.slug, max))}
              className={cn(
                "flex h-9 min-w-0 items-center gap-2 rounded-lg border px-2.5 text-left text-[13px] font-medium select-none",
                "transition-[transform,background-color,border-color,color,opacity] duration-150 ease-snappy",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg",
                selected ? "border-fg bg-white/[0.08] text-fg" : "border-line text-muted",
                unavailable ? "cursor-not-allowed opacity-40" : cn("active:scale-[0.97]", !selected && "hover:bg-white/[0.05] hover:text-fg"),
              )}
            >
              <DawLogo slug={daw.slug} className="h-4 w-4" />
              <span className="min-w-0 flex-1 truncate">{daw.name}</span>
              {selected && (
                <span
                  aria-hidden
                  className="flex h-4 w-4 shrink-0 animate-swap items-center justify-center rounded-full bg-fg text-[10px] font-semibold text-page tabular-nums"
                >
                  {order + 1}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p id={hintId} aria-live="polite" className="text-xs text-muted">
        {full ? `That's ${max}. Deselect one to pick another.` : `Pick up to ${max}, shown on your profile in this order.`}
      </p>
    </div>
  );
}
