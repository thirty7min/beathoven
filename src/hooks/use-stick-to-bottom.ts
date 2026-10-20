"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { nextStuck } from "@/lib/ui/stick-to-bottom";

const SCROLL_SETTLE_MS = 150;

export function useStickToBottom(latestKey: unknown) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const lastTop = useRef(0);
  const seenKey = useRef(latestKey);
  const touching = useRef(false);
  const lastWheelAt = useRef(0);
  const retry = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [hasNew, setHasNew] = useState(false);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    clearTimeout(retry.current);
    stuck.current = true;
    setHasNew(false);
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    lastTop.current = el.scrollTop;
  }, []);

  const follow = useCallback(() => {
    function attempt() {
      if (!stuck.current) return;
      if (touching.current || performance.now() - lastWheelAt.current < SCROLL_SETTLE_MS) {
        retry.current = setTimeout(attempt, SCROLL_SETTLE_MS);
        return;
      }
      scrollToBottom();
    }
    clearTimeout(retry.current);
    attempt();
  }, [scrollToBottom]);

  useLayoutEffect(() => {
    const changed = seenKey.current !== latestKey;
    seenKey.current = latestKey;
    if (stuck.current) follow();
    else if (changed) setHasNew(true);
  }, [latestKey, follow]);

  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    const onScroll = () => {
      stuck.current = nextStuck(stuck.current, lastTop.current, el);
      lastTop.current = el.scrollTop;
      if (stuck.current) setHasNew(false);
    };
    const onWheel = () => {
      lastWheelAt.current = performance.now();
    };
    const onTouchStart = () => {
      touching.current = true;
    };
    const onTouchEnd = () => {
      touching.current = false;
      follow();
    };
    const resize = new ResizeObserver(follow);
    resize.observe(el);
    resize.observe(content);
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    return () => {
      clearTimeout(retry.current);
      resize.disconnect();
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [follow]);

  return { scrollRef, contentRef, hasNew, scrollToBottom };
}
