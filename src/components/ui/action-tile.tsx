import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export const actionTileClasses =
  "inline-flex h-14 items-center gap-3 rounded-lg bg-raised px-6 text-[15px] font-semibold text-fg transition hover:bg-hover focus-visible:outline-2 focus-visible:outline-fg disabled:pointer-events-none disabled:opacity-40";

export function ActionTile({
  icon,
  className,
  children,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: ReactNode }) {
  return (
    <button type={type} className={cn(actionTileClasses, className)} {...rest}>
      <span className="text-muted [&>svg]:h-5 [&>svg]:w-5 [&>svg]:stroke-[1.75]">{icon}</span>
      {children}
    </button>
  );
}
