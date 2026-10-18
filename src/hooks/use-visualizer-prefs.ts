"use client";

import { useState } from "react";
import { cycleStyle, parsePrefs, type VisualizerPrefs } from "@/lib/ui/visualizer";

const STORAGE_KEY = "beathoven:visualizer";

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function load(): VisualizerPrefs {
  if (typeof window === "undefined") return parsePrefs(null);
  try {
    return parsePrefs(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return parsePrefs(null);
  }
}

export function useVisualizerPrefs() {
  const [reducedMotion] = useState(prefersReducedMotion);
  const [prefs, setPrefs] = useState(load);

  function save(next: VisualizerPrefs) {
    setPrefs(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
  }

  return {
    on: prefs.on,
    style: prefs.style,
    reducedMotion,
    toggle: () => save({ ...prefs, on: !prefs.on }),
    cycle: (direction: 1 | -1) => save({ ...prefs, style: cycleStyle(prefs.style, direction) }),
  };
}
