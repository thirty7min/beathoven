import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-line bg-surface", className)} {...rest} />;
}

export function Eyebrow({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return <span className={cn("text-[11px] font-semibold tracking-[0.08em] text-muted uppercase", className)} {...rest} />;
}

export function PageTitle({ title, subtitle, aside, className }: { title: string; subtitle?: string; aside?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-baseline gap-x-4 gap-y-1", className)}>
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
      {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      {aside && <div className="ml-auto self-center">{aside}</div>}
    </div>
  );
}
