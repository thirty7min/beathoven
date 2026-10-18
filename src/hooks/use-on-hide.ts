"use client";

import { useLayoutEffect, useRef, useState } from "react";

// Next keeps visited routes mounted but hidden (Activity), so per-visit state must be reset when a route hides.
export function useOnHide(onHide: () => void) {
  const latest = useRef(onHide);
  useLayoutEffect(() => {
    latest.current = onHide;
  });
  useLayoutEffect(() => () => latest.current(), []);
}

export function useVisit() {
  const [visit, setVisit] = useState(0);
  useOnHide(() => setVisit((v) => v + 1));
  return visit;
}
