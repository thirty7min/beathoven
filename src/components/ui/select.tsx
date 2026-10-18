"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "./cn";

export type SelectOption<T extends string | number> = { value: T; label: string; description?: string; icon?: ReactNode };

type Position = { top?: number; bottom?: number; right: number; minWidth: number };

const MENU_MAX_HEIGHT = 320;

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  const [position, setPosition] = useState<Position | null>(null);
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const id = useId();
  const open = position !== null;
  const selected = options.find((o) => o.value === value);

  function show() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom;
    const right = window.innerWidth - rect.right;
    setPosition(
      below < MENU_MAX_HEIGHT && rect.top > below
        ? { bottom: window.innerHeight - rect.top + 4, right, minWidth: rect.width }
        : { top: rect.bottom + 4, right, minWidth: rect.width },
    );
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
  }

  function close() {
    setPosition(null);
    triggerRef.current?.focus();
  }

  function choose(index: number) {
    const option = options[index];
    if (option) onChange(option.value);
    close();
  }

  useEffect(() => {
    if (!open) return;
    listRef.current?.focus();
    const outside = (target: EventTarget | null) =>
      !(target instanceof Node && (listRef.current?.contains(target) || triggerRef.current?.contains(target)));
    const onPointer = (e: PointerEvent) => outside(e.target) && setPosition(null);
    const onScroll = (e: Event) => outside(e.target) && setPosition(null);
    const onEscape = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setPosition(null);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    window.addEventListener("keydown", onEscape, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("keydown", onEscape, true);
    };
  }, [open]);

  function onTriggerKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      show();
    }
  }

  function onListKey(e: KeyboardEvent<HTMLUListElement>) {
    const last = options.length - 1;
    const moves: Record<string, number> = { ArrowDown: Math.min(last, active + 1), ArrowUp: Math.max(0, active - 1), Home: 0, End: last };
    if (e.key in moves) {
      e.preventDefault();
      setActive(moves[e.key]);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(active);
    } else if (e.key === "Tab") {
      setPosition(null);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => (open ? setPosition(null) : show())}
        onKeyDown={onTriggerKey}
        className={cn(
          "inline-flex h-9 min-w-32 items-center justify-between gap-2 rounded-lg border border-line-strong px-3 text-sm transition-colors hover:border-fg/60 focus:border-fg/60 focus:outline-none",
          open && "border-fg/60",
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-2 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0 [&>svg]:stroke-[1.75]">
          {selected?.icon}
          <span className="truncate">{selected?.label ?? "Select"}</span>
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted transition-transform duration-150 ease-snappy", open && "rotate-180")} />
      </button>
      {open &&
        createPortal(
          <ul
            ref={listRef}
            id={id}
            role="listbox"
            tabIndex={-1}
            aria-label={label}
            aria-activedescendant={`${id}-${active}`}
            onKeyDown={onListKey}
            style={{ ...position, maxHeight: MENU_MAX_HEIGHT, transformOrigin: position?.top !== undefined ? "top right" : "bottom right" }}
            className="scrollbar-thin fixed z-[60] max-w-80 animate-menu overflow-y-auto rounded-xl border border-line-strong bg-surface p-1 shadow-2xl focus:outline-none"
          >
            {options.map((option, i) => {
              const isSelected = option.value === value;
              return (
                <li
                  key={String(option.value)}
                  id={`${id}-${i}`}
                  role="option"
                  aria-selected={isSelected}
                  onPointerEnter={() => setActive(i)}
                  onClick={() => choose(i)}
                  className={cn("flex cursor-pointer items-start gap-2 rounded-lg px-3 py-2 text-sm", i === active && "bg-white/[0.06]")}
                >
                  {option.icon && <span className="mt-0.5 shrink-0 text-muted [&>svg]:h-4 [&>svg]:w-4 [&>svg]:stroke-[1.75]">{option.icon}</span>}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={cn(isSelected && "font-semibold")}>{option.label}</span>
                    {option.description && <span className="text-xs text-muted">{option.description}</span>}
                  </span>
                  <Check className={cn("mt-0.5 h-4 w-4 shrink-0", isSelected ? "opacity-100" : "opacity-0")} />
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </>
  );
}
