import type { ReactNode } from "react";
import { cn } from "./cn";

export function PageShell({ children, className }: { children: ReactNode; className?: string }) {
  return <main className={cn("mx-auto flex w-full max-w-[1280px] flex-1 flex-col gap-8 px-4 py-10 sm:px-8", className)}>{children}</main>;
}
