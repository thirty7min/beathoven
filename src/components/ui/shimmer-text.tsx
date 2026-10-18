import type { ReactNode } from "react";
import { cn } from "./cn";

export function ShimmerText({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "animate-shimmer bg-linear-to-r from-muted from-40% via-fg via-50% to-muted to-60% bg-[length:250%_100%] bg-clip-text text-transparent motion-reduce:animate-none motion-reduce:bg-none motion-reduce:text-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}
