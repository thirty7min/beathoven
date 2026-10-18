"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSound } from "@/components/sound-provider";
import { registerMedia } from "@/lib/ui/audio-unlock";

export function useAudioPreview() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const { gain, muted } = useSound();

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "none";
    const onTime = () => setProgress(audio.duration ? audio.currentTime / audio.duration : 0);
    const onEnd = () => {
      setPlayingId(null);
      setProgress(0);
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnd);
    audio.addEventListener("error", onEnd);
    audioRef.current = audio;
    const unregister = registerMedia(audio);
    return () => {
      unregister();
      audio.pause();
      audio.removeAttribute("src");
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnd);
      audio.removeEventListener("error", onEnd);
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = gain;
    audioRef.current.muted = muted;
  }, [gain, muted]);

  const toggle = useCallback(
    (id: string, url: string) => {
      const audio = audioRef.current;
      if (!audio) return;
      if (playingId === id) {
        audio.pause();
        setPlayingId(null);
        return;
      }
      audio.src = url;
      setProgress(0);
      setPlayingId(id);
      audio.play().catch(() => setPlayingId(null));
    },
    [playingId],
  );

  const stop = useCallback(() => {
    audioRef.current?.pause();
    setPlayingId(null);
  }, []);

  return { playingId, progress, toggle, stop };
}
