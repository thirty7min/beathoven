"use client";

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { nextTabIndex } from "@/lib/ui/tabs";
import { cn } from "./cn";

export type TabItem<T extends string> = { id: T; label: string; count?: number };
export type TabPanel<T extends string> = { id: T; content: ReactNode };

type Indicator = { x: number; width: number; animate: boolean };

const tabDomId = (ids: string, id: string) => `${ids}-tab-${id}`;
const panelDomId = (ids: string, id: string) => `${ids}-panel-${id}`;

export function Tabs<T extends string>({
  items,
  active,
  onChange,
  className,
  label,
  ids,
}: {
  items: TabItem<T>[];
  active: T;
  onChange?: (id: T) => void;
  className?: string;
  label: string;
  ids?: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<Indicator | null>(null);

  useLayoutEffect(() => {
    const node = list.current;
    if (!node) return;
    const measure = () => {
      const tab = node.querySelector<HTMLElement>(`[data-tab="${active}"]`);
      if (!tab) return;
      setIndicator((prev) => ({ x: tab.offsetLeft, width: tab.offsetWidth, animate: prev !== null }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [active, items.length]);

  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!onChange) return;
    const index = nextTabIndex(event.key, items.findIndex((item) => item.id === active), items.length);
    if (index === null) return;
    event.preventDefault();
    const next = items[index].id;
    onChange(next);
    list.current?.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus();
  }

  return (
    <div
      ref={list}
      role={onChange ? "tablist" : "list"}
      aria-label={label}
      onKeyDown={onKey}
      className={cn("relative flex gap-7 overflow-x-auto [scrollbar-width:none]", className)}
    >
      {items.map((item) => {
        const selected = item.id === active;
        const content = (
          <>
            <span className="grid">
              <span className="[grid-area:1/1]">{item.label}</span>
              <span aria-hidden className="invisible [grid-area:1/1] font-semibold">
                {item.label}
              </span>
            </span>
            {item.count !== undefined && <span className="ml-1.5 text-subtle tabular-nums">{item.count}</span>}
          </>
        );
        const classes = cn(
          "flex shrink-0 pt-1 pb-[15px] text-[15px] whitespace-nowrap transition-colors duration-150 ease-snappy outline-none focus-visible:text-fg",
          selected ? "font-semibold text-fg" : "text-muted",
          onChange && !selected && "hover:text-fg",
        );
        return onChange ? (
          <button
            key={item.id}
            type="button"
            role="tab"
            data-tab={item.id}
            id={ids && tabDomId(ids, item.id)}
            aria-controls={ids && panelDomId(ids, item.id)}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)}
            className={classes}
          >
            {content}
          </button>
        ) : (
          <span key={item.id} role="listitem" data-tab={item.id} aria-current={selected ? "step" : undefined} className={classes}>
            {content}
          </span>
        );
      })}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-line" />
      <span
        aria-hidden
        style={indicator ? { transform: `translateX(${indicator.x}px) scaleX(${indicator.width})` } : undefined}
        className={cn(
          "pointer-events-none absolute bottom-0 left-0 h-[3px] w-px origin-left bg-fg",
          !indicator && "opacity-0",
          indicator?.animate && "transition-transform duration-200 ease-snappy motion-reduce:transition-none",
        )}
      />
    </div>
  );
}

export function TabPanels<T extends string>({
  active,
  panels,
  ids,
  className,
  panelClassName,
}: {
  active: T;
  panels: TabPanel<T>[];
  ids?: string;
  className?: string;
  panelClassName?: string;
}) {
  const [visited, setVisited] = useState<T[]>([active]);
  if (!visited.includes(active)) setVisited([...visited, active]);

  return (
    <div className={cn("grid", className)}>
      {panels.map((panel) => {
        const selected = panel.id === active;
        if (!selected && !visited.includes(panel.id)) return null;
        return (
          <div
            key={panel.id}
            role="tabpanel"
            id={ids && panelDomId(ids, panel.id)}
            aria-labelledby={ids && tabDomId(ids, panel.id)}
            aria-hidden={!selected || undefined}
            inert={!selected}
            className={cn(
              "[grid-area:1/1] min-w-0 transition-[opacity,visibility] duration-150 ease-snappy motion-reduce:transition-none",
              selected ? "visible opacity-100" : "invisible opacity-0",
              panelClassName,
            )}
          >
            {panel.content}
          </div>
        );
      })}
    </div>
  );
}
