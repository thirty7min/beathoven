import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

export function Pill({ selected, className, type = "button", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-full border px-4 text-[13px] font-medium transition",
        selected ? "border-fg bg-white/[0.08] text-fg" : "border-line-strong text-fg hover:bg-white/[0.05]",
        className,
      )}
      {...rest}
    />
  );
}
