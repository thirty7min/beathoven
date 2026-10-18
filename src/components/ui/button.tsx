import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";
import { Spinner } from "./spinner";

const VARIANTS = {
  primary: "bg-fg text-page hover:bg-white/85",
  outline: "border border-line-strong text-fg hover:bg-white/[0.06]",
  secondary: "bg-raised text-fg hover:bg-hover",
  ghost: "text-muted hover:bg-white/[0.06] hover:text-fg",
  danger: "border border-danger/40 text-danger hover:bg-danger/10",
} as const;

const SIZES = {
  sm: "h-8 gap-1.5 px-3.5 text-[13px]",
  md: "h-10 gap-2 px-5 text-sm",
  lg: "h-12 gap-2 px-7 text-[15px]",
  icon: "h-9 w-9",
} as const;

export type ButtonVariant = keyof typeof VARIANTS;
export type ButtonSize = keyof typeof SIZES;

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
};

export function buttonClasses(variant: ButtonVariant = "outline", size: ButtonSize = "md") {
  return cn(
    "inline-flex shrink-0 items-center justify-center rounded-full font-semibold transition-[transform,background-color,border-color,color,opacity] duration-150 ease-snappy select-none active:scale-[0.97] disabled:active:scale-100",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg",
    "disabled:pointer-events-none disabled:opacity-40",
    VARIANTS[variant],
    SIZES[size],
  );
}

export function Button({ variant, size, loading, disabled, className, children, type = "button", ...rest }: ButtonProps) {
  return (
    <button type={type} disabled={disabled || loading} className={cn(buttonClasses(variant, size), className)} {...rest}>
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}
