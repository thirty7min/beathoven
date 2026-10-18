"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSound } from "@/components/sound-provider";
import type { Playback } from "@/lib/game/phase";
import { fadeGain, syncAudio } from "@/lib/game/playback-sync";
import { connectMedia, setGraphBoost, setGraphGain, type MediaGraph } from "@/lib/ui/audio-graph";
import { isAudioBlocked, registerMedia, reportAudioBlocked, subscribeAudioBlocked } from "@/lib/ui/audio-unlock";

export function useSyncedAudio(playback: Playback, url: string | null, boostDb = 0) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const graphRef = useRef<MediaGraph | null>(null);
  const [buffering, setBuffering] = useState(false);
  const stalled = useRef(false);
  const lastSeekAt = useRef<number | null>(null);
  const lastStallAt = useRef<number | null>(null);
  const blocked = useSyncExternalStore(subscribeAudioBlocked, isAudioBlocked, () => false);
  const { gain, muted } = useSound();

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    graphRef.current = connectMedia(audio);
    return registerMedia(audio);
  }, []);

  useEffect(() => {
    stalled.current = false;
    lastSeekAt.current = null;
    lastStallAt.current = null;
  }, [url]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!url) {
      if (!audio.paused) audio.pause();
      return;
    }
    const target = gain * fadeGain(playback);
    const graph = graphRef.current;
    if (graph) {
      if (audio.volume !== 1) audio.volume = 1;
      if (audio.muted) audio.muted = false;
      setGraphGain(graph, muted ? 0 : target);
      setGraphBoost(graph, boostDb);
    } else {
      if (Math.abs(audio.volume - target) > 0.001) audio.volume = target;
      if (audio.muted !== muted) audio.muted = muted;
    }
    const now = performance.now();
    const action = syncAudio(playback, {
      paused: audio.paused,
      currentTimeMs: audio.currentTime * 1000,
      seeking: audio.seeking,
      ready: audio.readyState >= HTMLMediaElement.HAVE_METADATA,
      buffering: stalled.current || audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA,
      msSinceSeek: lastSeekAt.current === null ? null : now - lastSeekAt.current,
      msSinceStall: lastStallAt.current === null ? null : now - lastStallAt.current,
    });
    if (action.type === "none") return;
    if (action.seekToMs !== null) {
      audio.currentTime = action.seekToMs / 1000;
      lastSeekAt.current = now;
    }
    if (action.type === "pause") {
      audio.pause();
      return;
    }
    if (graph?.context.state === "suspended" && !muted) reportAudioBlocked();
    if (audio.paused && !blocked) {
      audio.play().catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "NotAllowedError") reportAudioBlocked();
      });
    }
  });

  function onStall() {
    stalled.current = true;
    lastStallAt.current = performance.now();
    setBuffering(true);
  }

  const audioProps = {
    ref: audioRef,
    crossOrigin: "anonymous" as const,
    src: url ?? undefined,
    preload: "auto" as const,
    onWaiting: onStall,
    onStalled: onStall,
    onPlaying: () => {
      stalled.current = false;
      setBuffering(false);
    },
    onCanPlay: () => setBuffering(false),
  };

  const analyser = useCallback(() => graphRef.current?.analyser ?? null, []);
  return { audioProps, blocked, buffering, analyser };
}
