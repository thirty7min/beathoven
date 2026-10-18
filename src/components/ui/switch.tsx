import { cn } from "./cn";

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  describedBy,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  describedBy?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-[background-color,border-color] duration-150 ease-snappy focus-visible:outline focus-visible:outline-offset-2 focus-visible:outline-fg/40 disabled:opacity-40",
        checked ? "border-fg bg-fg" : "border-line-strong bg-white/[0.06]",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute left-0.5 size-4 rounded-full transition-[transform,background-color] duration-150 ease-snappy motion-reduce:transition-none",
          checked ? "translate-x-4 bg-page" : "translate-x-0 bg-muted",
        )}
      />
    </button>
  );
}
