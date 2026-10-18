"use client";

import { useEffect, useState } from "react";
import { devToolsEnabled } from "@/lib/game/dev-bots";

let check: Promise<boolean> | null = null;

export function useDevToolsEnabled(active = true) {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    check ??= devToolsEnabled();
    check.then((value) => !cancelled && setEnabled(value));
    return () => {
      cancelled = true;
    };
  }, [active]);

  return active && enabled;
}
