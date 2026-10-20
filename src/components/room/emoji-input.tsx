"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type InputHTMLAttributes, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/components/ui/cn";
import { loadEmojiIndex } from "@/lib/game/emoji-data";
import { completeShortcode, emojiToken, insertEmoji, searchEmoji, type EmojiIndex } from "@/lib/game/emoji-shortcodes";

type Anchor = { left: number; bottom: number; width: number };

const MENU_GAP = 6;

export function EmojiInput({
  value,
  onValueChange,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "role"> & { value: string; onValueChange: (value: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [index, setIndex] = useState<EmojiIndex | null>(null);
  const [caret, setCaret] = useState(value.length);
  const [highlight, setHighlight] = useState({ start: -1, query: "", position: 0 });
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const id = useId();

  const token = emojiToken(value, caret);
  const query = token?.query;
  const matches = useMemo(() => (index && query !== undefined ? searchEmoji(index, query) : []), [index, query]);
  const open = token !== null && matches.length > 0 && dismissedAt !== token.start;
  const active = token && highlight.start === token.start && highlight.query === token.query ? Math.min(highlight.position, matches.length - 1) : 0;

  useLayoutEffect(() => {
    const caretAt = pendingCaret.current;
    if (caretAt === null) return;
    pendingCaret.current = null;
    inputRef.current?.setSelectionRange(caretAt, caretAt);
  }, [value]);

  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const rect = inputRef.current?.getBoundingClientRect();
      if (rect) setAnchor({ left: rect.left, bottom: window.innerHeight - rect.top + MENU_GAP, width: rect.width });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open]);

  useEffect(() => {
    if (index || !value.includes(":")) return;
    let cancelled = false;
    loadEmojiIndex().then(
      (loaded) => !cancelled && setIndex(loaded),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [index, value]);

  function apply(next: { text: string; caret: number }) {
    pendingCaret.current = next.caret;
    setCaret(next.caret);
    onValueChange(next.text);
  }

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const text = event.target.value;
    const at = event.target.selectionStart ?? text.length;
    const completed = index ? completeShortcode(text, at, index) : null;
    if (completed) {
      apply(completed);
      return;
    }
    setCaret(at);
    if (dismissedAt !== null && emojiToken(text, at)?.start !== dismissedAt) setDismissedAt(null);
    onValueChange(text);
  }

  function choose(position: number) {
    const match = matches[position];
    if (!match || !token) return;
    apply(insertEmoji(value, token, caret, match.glyph));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    rest.onKeyDown?.(event);
    if (!open || !token || event.defaultPrevented) return;
    const last = matches.length - 1;
    const moves: Record<string, number> = { ArrowDown: active === last ? 0 : active + 1, ArrowUp: active === 0 ? last : active - 1 };
    if (event.key in moves) {
      event.preventDefault();
      setHighlight({ start: token.start, query: token.query, position: moves[event.key] });
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      choose(active);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setDismissedAt(token.start);
    }
  }

  return (
    <>
      <input
        {...rest}
        ref={inputRef}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? value.length)}
        onBlur={(event) => {
          rest.onBlur?.(event);
          setDismissedAt(token?.start ?? null);
        }}
        onFocus={(event) => {
          rest.onFocus?.(event);
          setDismissedAt(null);
        }}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
      />
      {open &&
        anchor &&
        createPortal(
          <ul
            id={id}
            role="listbox"
            aria-label="Emoji suggestions"
            style={{ left: anchor.left, bottom: anchor.bottom, minWidth: anchor.width, transformOrigin: "bottom left" }}
            className="scrollbar-thin fixed z-[60] max-h-80 max-w-80 animate-menu overflow-y-auto rounded-xl border border-line-strong bg-surface p-1 shadow-2xl"
          >
            {matches.map((match, position) => (
              <li
                key={match.name}
                id={`${id}-${position}`}
                role="option"
                aria-selected={position === active}
                onPointerDown={(event) => event.preventDefault()}
                onPointerEnter={() => setHighlight({ start: token.start, query: token.query, position })}
                onClick={() => choose(position)}
                className={cn("flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm", position === active && "bg-white/[0.06]")}
              >
                <span aria-hidden className="w-6 shrink-0 text-center text-lg leading-7">
                  {match.glyph}
                </span>
                <span className="min-w-0 truncate">:{match.name}:</span>
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </>
  );
}
