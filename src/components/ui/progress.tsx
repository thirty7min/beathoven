import { cn } from "./cn";

export function ProgressBar({ value, className, barClassName }: { value: number; className?: string; barClassName?: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 1000) / 10;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={cn("h-1 w-full overflow-hidden rounded-full bg-white/10", className)}
    >
      <div className={cn("h-full w-full origin-left rounded-full bg-fg transition-transform duration-200 ease-linear", barClassName)} style={{ transform: `scaleX(${pct / 100})` }} />
    </div>
  );
}
