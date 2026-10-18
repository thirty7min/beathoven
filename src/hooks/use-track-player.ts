"use client";

import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { useSound } from "@/components/sound-provider";
import { registerMedia } from "@/lib/ui/audio-unlock";

export function useTrackPlayer(url: string | null) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [timeMs, setTimeMs] = useState(0);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const { gain, muted } = useSound();

  useEffect(() => {
    const audio = audioRef.current;
    return audio ? registerMedia(audio) : undefined;
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = gain;
    audio.muted = muted;
  }, [gain, muted, url]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      if (audioRef.current) setTimeMs(audioRef.current.currentTime * 1000);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  function toggle() {
    const audio = audioRef.current;
    if (!audio || !url) return;
    if (audio.paused) audio.play().catch(() => setPlaying(false));
    else audio.pause();
  }

  function seek(fraction: number) {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.min(1, Math.max(0, fraction)) * audio.duration;
    setTimeMs(audio.currentTime * 1000);
  }

  const audioProps = {
    ref: audioRef,
    src: url ?? undefined,
    preload: "metadata" as const,
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => {
      setPlaying(false);
      setTimeMs(0);
    },
    onLoadedMetadata: (e: SyntheticEvent<HTMLAudioElement>) => setDurationMs(e.currentTarget.duration * 1000),
  };

  return { audioProps, playing, timeMs, durationMs, toggle, seek };
}
