import type { HTMLAttributes } from "react";
import { cn } from "./cn";

const TONES = {
  neutral: "bg-white/[0.08] text-muted",
  solid: "bg-fg text-page",
  outline: "border border-line-strong text-fg",
  danger: "bg-danger/15 text-danger",
} as const;

export function Badge({ tone = "neutral", className, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof TONES }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap [&>svg]:h-3 [&>svg]:w-3",
        TONES[tone],
        className,
      )}
      {...rest}
    />
  );
}

export function HighlightPill({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-fg px-3 py-1 text-[13px] font-semibold text-page [&>svg]:h-3.5 [&>svg]:w-3.5",
        className,
      )}
      {...rest}
    />
  );
}
