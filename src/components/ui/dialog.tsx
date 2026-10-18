"use client";

import { X } from "lucide-react";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "./cn";

const noSubscription = () => () => {};

export function Dialog({
  open,
  onClose,
  title,
  label,
  children,
  className,
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  label?: string;
  children: ReactNode;
  className?: string;
  dismissible?: boolean;
}) {
  useEffect(() => {
    if (!open || !dismissible) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, dismissible]);

  const onClient = useSyncExternalStore(noSubscription, () => true, () => false);

  if (!open || !onClient) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      {dismissible ? (
        <button aria-label="Close" className="absolute inset-0 cursor-default bg-black/75" onClick={onClose} />
      ) : (
        <div className="absolute inset-0 bg-black/75" />
      )}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title ?? label}
        className={cn("relative w-full max-w-md animate-sheet rounded-t-2xl sm:animate-pop border border-line bg-surface p-6 shadow-2xl sm:rounded-2xl", className)}
      >
        {(title || dismissible) && (
          <div className="mb-4 flex items-start justify-between gap-4">
            {title && <h2 className="text-lg font-bold">{title}</h2>}
            {dismissible && (
              <button onClick={onClose} aria-label="Close" className="-m-1 ml-auto rounded-full p-1.5 text-muted hover:bg-white/[0.06] hover:text-fg">
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
