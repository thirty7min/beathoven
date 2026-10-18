"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { useSound } from "@/components/sound-provider";
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

function ramp(audio: HTMLAudioElement, to: number, durationMs: number, done?: () => void) {
  const from = audio.volume;
  const start = performance.now();
  let frame = 0;
  const step = () => {
    const elapsed = performance.now() - start;
    audio.volume = Math.min(1, Math.max(0, fadeVolume(from, to, elapsed, durationMs)));
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

function fade(slot: FadeSlot, audio: HTMLAudioElement, to: number, durationMs: number, done?: () => void) {
  cancelFade(slot);
  slot.current = ramp(audio, to, durationMs, () => {
    slot.current = null;
    done?.();
  });
}

export function useHoverPreview() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urls = useRef(new Map<string, string>());
  const limits = useRef(new Map<string, number | null>());
  const activeRef = useRef<string | null>(null);
  const intentTimer = useRef<number | null>(null);
  const generationRef = useRef(0);
  const fadeRef = useRef<(() => void) | null>(null);
  const [state, dispatch] = useReducer(previewReducer, initialPreviewState);
  const [progress, setProgress] = useState(0);
  const { gain, muted } = useSound();
  const gainRef = useRef(gain);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "none";
    audioRef.current = audio;
    const unregister = registerMedia(audio);
    const onTime = () => {
      const id = activeRef.current;
      const { progress, done } = previewProgress(audio.currentTime * 1000, audio.duration * 1000, id ? (limits.current.get(id) ?? null) : null);
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
    const audio = audioRef.current;
    if (audio && !audio.paused) audio.volume = gain;
    if (audio) audio.muted = muted;
  }, [gain, muted]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const id = state.activeId;
    const generation = ++generationRef.current;
    const current = () => generation === generationRef.current;
    const transition = previewTransition(!audio.paused && audio.volume > 0, id);
    if (transition === "none" || transition === "stop") activeRef.current = null;
    if (transition === "none") {
      cancelFade(fadeRef);
      audio.pause();
      return;
    }
    if (transition === "stop") {
      fade(fadeRef, audio, 0, PREVIEW_FADE_OUT_MS, () => audio.pause());
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
      audio.currentTime = 0;
      audio.volume = 0;
      audio.addEventListener("ended", onEnded);
      audio.play().then(
        () => current() && fade(fadeRef, audio, gainRef.current, PREVIEW_FADE_IN_MS),
        (error: unknown) => current() && !isStaleAbort(error) && dispatch({ type: "blocked", id }),
      );
    };
    if (transition === "handoff") fade(fadeRef, audio, 0, PREVIEW_FADE_OUT_MS, start);
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
    enter(id: string, url: string, limitMs: number | null = null) {
      urls.current.set(id, url);
      limits.current.set(id, limitMs);
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
      audio.currentTime = ms / 1000;
    },
    tap(id: string, url: string, limitMs: number | null = null) {
      urls.current.set(id, url);
      limits.current.set(id, limitMs);
      clearIntent();
      setProgress(0);
      dispatch({ type: "tap", id });
    },
  };
}
