import { Search } from "lucide-react";
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { cn } from "./cn";

export const inputClasses =
  "w-full rounded-lg border border-line bg-raised px-3.5 py-2.5 text-sm text-fg placeholder:text-subtle transition focus:border-fg/60 focus:outline-none disabled:opacity-50";

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {error ? <span className="text-xs text-danger">{error}</span> : hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputClasses, className)} {...rest} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(inputClasses, "resize-none", className)} {...rest} />;
}

export function SearchInput({ className, variant = "outline", ...rest }: InputHTMLAttributes<HTMLInputElement> & { variant?: "outline" | "filled" }) {
  return (
    <div className={cn("relative flex items-center", className)}>
      <Search className="pointer-events-none absolute left-4 h-4 w-4 text-muted" />
      <input
        type="search"
        className={cn(
          "h-10 w-full rounded-full pr-4 pl-11 text-sm text-fg placeholder:text-muted transition focus:outline-none",
          variant === "outline" ? "border border-line-strong bg-transparent focus:border-fg/60" : "bg-raised focus:bg-hover",
        )}
        {...rest}
      />
    </div>
  );
}
