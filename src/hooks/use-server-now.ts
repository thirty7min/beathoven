"use client";

import { useEffect, useState } from "react";
import type { ServerClock } from "@/lib/game/clock";

export function useServerNow(clock: ServerClock, intervalMs = 250): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(clock.now());
    const frame = requestAnimationFrame(tick);
    const id = setInterval(tick, intervalMs);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(id);
    };
  }, [clock, intervalMs]);

  return now;
}
