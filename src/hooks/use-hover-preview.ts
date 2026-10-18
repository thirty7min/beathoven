"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { useSound } from "@/components/sound-provider";
import { connectMedia, setGraphBoost, setMediaLevel, type MediaGraph } from "@/lib/ui/audio-graph";
import { registerMedia } from "@/lib/ui/audio-unlock";
import {
  HOVER_INTENT_MS,
  PREVIEW_FADE_IN_MS,
  PREVIEW_FADE_OUT_MS,
  fadeVolume,
  initialPreviewState,
  previewProgress,
  isStaleAbort,
  previewReducer,
  previewTransition,
} from "@/lib/ui/hover-preview";

type Level = { get: () => number; set: (value: number) => void };

function ramp(level: Level, to: number, durationMs: number, done?: () => void) {
  const from = level.get();
  const start = performance.now();
  let frame = 0;
  const step = () => {
    const elapsed = performance.now() - start;
    level.set(Math.min(1, Math.max(0, fadeVolume(from, to, elapsed, durationMs))));
    if (elapsed < durationMs) frame = requestAnimationFrame(step);
    else done?.();
  };
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}

type FadeSlot = { current: (() => void) | null };

function cancelFade(slot: FadeSlot) {
  slot.current?.();
  slot.current = null;
}

function fade(slot: FadeSlot, level: Level, to: number, durationMs: number, done?: () => void) {
  cancelFade(slot);
  slot.current = ramp(level, to, durationMs, () => {
    slot.current = null;
    done?.();
  });
}

export function useHoverPreview() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urls = useRef(new Map<string, string>());
  const windows = useRef(new Map<string, { startMs: number; limitMs: number | null; boostDb: number }>());
  const graphRef = useRef<MediaGraph | null>(null);
  const levelValue = useRef(0);
  const mutedRef = useRef(false);
  const activeRef = useRef<string | null>(null);
  const intentTimer = useRef<number | null>(null);
  const generationRef = useRef(0);
  const fadeRef = useRef<(() => void) | null>(null);
  const [state, dispatch] = useReducer(previewReducer, initialPreviewState);
  const [progress, setProgress] = useState(0);
  const { gain, muted } = useSound();
  const gainRef = useRef(gain);
  const level = useRef<Level>({
    get: () => levelValue.current,
    set: (value) => {
      levelValue.current = value;
      if (audioRef.current) setMediaLevel(audioRef.current, graphRef.current, value, mutedRef.current);
    },
  });

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "none";
    audio.crossOrigin = "anonymous";
    audioRef.current = audio;
    graphRef.current = connectMedia(audio);
    const unregister = registerMedia(audio);
    const onTime = () => {
      const id = activeRef.current;
      const clip = id ? windows.current.get(id) : undefined;
      const startMs = clip?.startMs ?? 0;
      const { progress, done } = previewProgress(audio.currentTime * 1000 - startMs, audio.duration * 1000 - startMs, clip?.limitMs ?? null);
      setProgress(progress);
      if (done && id) dispatch({ type: "ended", id });
    };
    audio.addEventListener("timeupdate", onTime);
    return () => {
      unregister();
      audio.pause();
      audio.removeAttribute("src");
      audio.removeEventListener("timeupdate", onTime);
      audioRef.current = null;
      cancelFade(fadeRef);
      if (intentTimer.current !== null) window.clearTimeout(intentTimer.current);
    };
  }, []);

  useEffect(() => {
    gainRef.current = gain;
    mutedRef.current = muted;
    const audio = audioRef.current;
    if (!audio) return;
    level.current.set(audio.paused ? levelValue.current : gain);
  }, [gain, muted]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const id = state.activeId;
    const generation = ++generationRef.current;
    const current = () => generation === generationRef.current;
    const transition = previewTransition(!audio.paused && levelValue.current > 0, id);
    if (transition === "none" || transition === "stop") activeRef.current = null;
    if (transition === "none") {
      cancelFade(fadeRef);
      audio.pause();
      return;
    }
    if (transition === "stop") {
      fade(fadeRef, level.current, 0, PREVIEW_FADE_OUT_MS, () => audio.pause());
      return;
    }
    const url = id ? urls.current.get(id) : undefined;
    if (!id || !url) return;
    const onEnded = () => current() && dispatch({ type: "ended", id });
    const start = () => {
      if (!current()) return;
      cancelFade(fadeRef);
      activeRef.current = id;
      setProgress(0);
      audio.pause();
      audio.src = url;
      audio.currentTime = (windows.current.get(id)?.startMs ?? 0) / 1000;
      level.current.set(0);
      if (graphRef.current) setGraphBoost(graphRef.current, windows.current.get(id)?.boostDb ?? 0);
      audio.addEventListener("ended", onEnded);
      audio.play().then(
        () => current() && fade(fadeRef, level.current, gainRef.current, PREVIEW_FADE_IN_MS),
        (error: unknown) => current() && !isStaleAbort(error) && dispatch({ type: "blocked", id }),
      );
    };
    if (transition === "handoff") fade(fadeRef, level.current, 0, PREVIEW_FADE_OUT_MS, start);
    else start();
    return () => audio.removeEventListener("ended", onEnded);
  }, [state.activeId]);

  function clearIntent() {
    if (intentTimer.current !== null) window.clearTimeout(intentTimer.current);
    intentTimer.current = null;
  }

  return {
    activeId: state.activeId,
    blockedId: state.blockedId,
    progress: state.activeId ? progress : 0,
    enter(id: string, url: string, limitMs: number | null = null, startMs = 0, boostDb = 0) {
      urls.current.set(id, url);
      windows.current.set(id, { startMs, limitMs, boostDb });
      clearIntent();
      dispatch({ type: "enter", id });
      intentTimer.current = window.setTimeout(() => dispatch({ type: "intent", id }), HOVER_INTENT_MS);
    },
    leave(id: string) {
      clearIntent();
      dispatch({ type: "leave", id });
    },
    seek(id: string, ms: number) {
      const audio = audioRef.current;
      if (!audio || activeRef.current !== id) return;
      audio.currentTime = ((windows.current.get(id)?.startMs ?? 0) + ms) / 1000;
    },
    tap(id: string, url: string, limitMs: number | null = null, startMs = 0, boostDb = 0) {
      urls.current.set(id, url);
      windows.current.set(id, { startMs, limitMs, boostDb });
      clearIntent();
      setProgress(0);
      dispatch({ type: "tap", id });
    },
  };
}
