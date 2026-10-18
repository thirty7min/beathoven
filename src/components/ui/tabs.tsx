import { cn } from "./cn";

export type TabItem<T extends string> = { id: T; label: string; count?: number };

export function Tabs<T extends string>({
  items,
  active,
  onChange,
  className,
  label,
}: {
  items: TabItem<T>[];
  active: T;
  onChange?: (id: T) => void;
  className?: string;
  label: string;
}) {
  return (
    <div role={onChange ? "tablist" : "list"} aria-label={label} className={cn("flex gap-7 overflow-x-auto border-b border-line", className)}>
      {items.map((item) => {
        const selected = item.id === active;
        const content = (
          <>
            {item.label}
            {item.count !== undefined && <span className="ml-1.5 text-subtle tabular-nums">{item.count}</span>}
          </>
        );
        const classes = cn(
          "-mb-px shrink-0 border-b-[3px] pt-1 pb-3 text-[15px] whitespace-nowrap transition",
          selected ? "border-fg font-semibold text-fg" : "border-transparent text-muted",
          onChange && !selected && "hover:text-fg",
        );
        return onChange ? (
          <button key={item.id} role="tab" aria-selected={selected} onClick={() => onChange(item.id)} className={classes}>
            {content}
          </button>
        ) : (
          <span key={item.id} role="listitem" aria-current={selected ? "step" : undefined} className={classes}>
            {content}
          </span>
        );
      })}
    </div>
  );
}
