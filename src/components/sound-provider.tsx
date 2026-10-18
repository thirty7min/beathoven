"use client";

import { createContext, use, useCallback, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { installAudioUnlock } from "@/lib/ui/audio-unlock";

const MUTED_KEY = "bb:muted";
const VOLUME_KEY = "bb:volume";
const CHANGE_EVENT = "bb:sound-change";
const DEFAULT_VOLUME = 0.9;

type SoundContextValue = {
  muted: boolean;
  volume: number;
  gain: number;
  toggleMuted: () => void;
  setVolume: (volume: number) => void;
};

const SoundContext = createContext<SoundContextValue>({
  muted: false,
  volume: DEFAULT_VOLUME,
  gain: DEFAULT_VOLUME,
  toggleMuted: () => undefined,
  setVolume: () => undefined,
});

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

const readMuted = () => window.localStorage.getItem(MUTED_KEY) === "1";

function readVolume() {
  const raw = window.localStorage.getItem(VOLUME_KEY);
  const value = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : DEFAULT_VOLUME;
}

function write(key: string, value: string) {
  window.localStorage.setItem(key, value);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function SoundProvider({ children }: { children: ReactNode }) {
  const muted = useSyncExternalStore(subscribe, readMuted, () => false);
  const volume = useSyncExternalStore(subscribe, readVolume, () => DEFAULT_VOLUME);

  useEffect(() => installAudioUnlock(), []);

  const toggleMuted = useCallback(() => write(MUTED_KEY, readMuted() ? "0" : "1"), []);
  const setVolume = useCallback((next: number) => {
    write(VOLUME_KEY, String(Math.min(1, Math.max(0, next))));
    if (next > 0 && readMuted()) write(MUTED_KEY, "0");
  }, []);

  const value = useMemo(
    () => ({ muted, volume, gain: muted ? 0 : volume, toggleMuted, setVolume }),
    [muted, volume, toggleMuted, setVolume],
  );
  return <SoundContext value={value}>{children}</SoundContext>;
}

export function useSound() {
  return use(SoundContext);
}
