import type { ReactNode } from "react";
import { cn } from "./cn";

export function SelectCard({
  selected,
  onSelect,
  title,
  value,
  description,
  icon,
  className,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  value?: ReactNode;
  description?: string;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex flex-col items-start gap-1.5 rounded-xl border p-4 text-left transition",
        selected ? "border-fg bg-white/[0.06]" : "border-line bg-surface hover:border-line-strong",
        className,
      )}
    >
      <span className="flex w-full items-center gap-2 text-sm text-muted">
        {icon && <span className={cn("[&>svg]:h-4 [&>svg]:w-4", selected ? "text-fg" : "text-muted")}>{icon}</span>}
        <span className={cn(selected && "text-fg")}>{title}</span>
      </span>
      {value !== undefined && <span className="text-xl font-semibold tabular-nums">{value}</span>}
      {description && <span className="text-[13px] leading-relaxed text-muted">{description}</span>}
    </button>
  );
}
