import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

export function StageHeader({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <div className="relative flex min-h-16 items-center justify-center px-6 pt-6 pb-2">
      <h1 className="flex flex-col items-center gap-2 text-lg font-bold tracking-[0.25em] uppercase sm:text-xl">
        {title}
        <span aria-hidden className="h-0.5 w-10 rounded-full bg-fg" />
      </h1>
      {aside && <div className="absolute top-5 right-5 sm:right-6">{aside}</div>}
    </div>
  );
}

export function StageCounter({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-end", className)}>
      <span className="text-[10px] font-semibold tracking-[0.14em] text-muted uppercase">{label}</span>
      <span className="text-2xl leading-tight font-black tabular-nums sm:text-3xl">{value}</span>
    </div>
  );
}
