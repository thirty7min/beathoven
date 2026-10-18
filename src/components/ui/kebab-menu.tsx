"use client";

import { MoreVertical } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "./cn";

export type KebabItem = { label: string; icon?: ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean };

type Position = { top?: number; bottom?: number; right: number };

const MENU_ROOM = 200;

export function KebabMenu({ items, label = "More actions" }: { items: KebabItem[]; label?: string }) {
  const [position, setPosition] = useState<Position | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = position !== null;

  function show() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const right = window.innerWidth - rect.right;
    const below = window.innerHeight - rect.bottom;
    setPosition(below < MENU_ROOM && rect.top > below ? { bottom: window.innerHeight - rect.top + 4, right } : { top: rect.bottom + 4, right });
  }

  useEffect(() => {
    if (!open) return;
    const outside = (target: EventTarget | null) =>
      !(target instanceof Node && (menuRef.current?.contains(target) || triggerRef.current?.contains(target)));
    const onPointer = (e: PointerEvent) => outside(e.target) && setPosition(null);
    const onScroll = (e: Event) => outside(e.target) && setPosition(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setPosition(null);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <div className="relative justify-self-end">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? setPosition(null) : show())}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-full text-muted transition-[transform,background-color,color] duration-150 ease-snappy hover:bg-white/[0.06] hover:text-fg active:scale-[0.97]",
          open && "bg-white/[0.06] text-fg",
        )}
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ ...position, transformOrigin: position?.top !== undefined ? "top right" : "bottom right" }}
            className="fixed z-[60] min-w-44 animate-menu rounded-xl border border-line bg-raised p-1 shadow-2xl"
          >
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setPosition(null);
                  item.onSelect();
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-white/[0.06] disabled:cursor-default disabled:text-muted disabled:hover:bg-transparent [&>svg]:h-4 [&>svg]:w-4 [&>svg]:text-muted",
                  item.danger ? "text-danger" : "text-fg",
                )}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
