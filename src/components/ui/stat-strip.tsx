import type { ReactNode } from "react";
import { cn } from "./cn";

export type Stat = { label: string; value: ReactNode; hero?: boolean };

export function StatStrip({ stats, className }: { stats: Stat[]; className?: string }) {
  return (
    <dl className={cn("flex flex-wrap items-stretch gap-y-4", className)}>
      {stats.map((stat, i) => (
        <div
          key={stat.label}
          className={cn(
            "flex min-w-0 flex-col justify-end gap-1.5 pr-6 sm:pr-10",
            i > 0 && "border-l border-line pl-6 sm:pl-10",
            stat.hero && "basis-full border-l-0 pl-0 sm:basis-auto",
            stat.hero && i === 0 && "sm:border-r-0",
          )}
        >
          <dd
            className={cn(
              "font-bold tracking-tight tabular-nums",
              stat.hero ? "text-5xl leading-none sm:text-6xl" : "text-2xl leading-none",
            )}
          >
            {stat.value}
          </dd>
          <dt className="text-[13px] font-medium text-muted">{stat.label}</dt>
        </div>
      ))}
    </dl>
  );
}
