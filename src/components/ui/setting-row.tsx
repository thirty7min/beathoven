import { Info, Minus, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";
import { Tooltip } from "./tooltip";

export function SettingList({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col divide-y divide-line border-y border-line", className)}>{children}</div>;
}

export function SettingRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-4 py-2.5">
      <span className="flex items-center gap-1.5 text-sm font-medium">
        {label}
        {hint && (
          <Tooltip content={hint} className="p-0.5 text-subtle transition-colors duration-150 hover:text-fg">
            <Info aria-hidden className="h-3.5 w-3.5" />
            <span className="sr-only">{hint}</span>
          </Tooltip>
        )}
      </span>
      <div className="flex shrink-0 items-center text-sm">{children}</div>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex h-9 rounded-lg border border-line-strong p-0.5">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-md px-3 text-[13px] font-medium transition",
              selected ? "bg-white/[0.12] text-fg" : "text-muted hover:text-fg",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Stepper({
  value,
  min,
  max,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
}) {
  const button = "flex h-full w-9 items-center justify-center text-muted transition hover:text-fg disabled:opacity-30 disabled:hover:text-muted";
  return (
    <div role="group" aria-label={label} className="inline-flex h-9 items-center rounded-lg border border-line-strong">
      <button type="button" aria-label={`Fewer ${label.toLowerCase()}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))} className={button}>
        <Minus className="h-3.5 w-3.5" />
      </button>
      <output aria-live="polite" className="w-7 text-center text-sm font-semibold tabular-nums">
        {value}
      </output>
      <button type="button" aria-label={`More ${label.toLowerCase()}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))} className={button}>
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
