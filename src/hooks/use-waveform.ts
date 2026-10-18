"use client";

import { useEffect, useState } from "react";
import { waveformHeights } from "@/lib/game/waveform";

const cache = new Map<string, Promise<number[]>>();

async function decodePeaks(url: string, clipMs: number | null, startMs: number): Promise<number[]> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Couldn't fetch audio (${response.status})`);
  const data = await response.arrayBuffer();
  const context = new OfflineAudioContext(1, 1, 44_100);
  const buffer = await context.decodeAudioData(data);
  const from = Math.min(buffer.length, Math.max(0, Math.round((startMs / 1000) * buffer.sampleRate)));
  const to = clipMs === null ? buffer.length : Math.min(buffer.length, from + Math.round((clipMs / 1000) * buffer.sampleRate));
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i).subarray(from, to));
  return waveformHeights(channels);
}

function peaksFor(key: string, url: string, clipMs: number | null, startMs: number): Promise<number[]> {
  const hit = cache.get(key);
  if (hit) return hit;
  const promise = decodePeaks(url, clipMs, startMs);
  promise.catch(() => cache.delete(key));
  cache.set(key, promise);
  return promise;
}

type WaveformState = { key: string | null; peaks: number[] | null; error: boolean };

export function useWaveform(path: string | null | undefined, url: string | null, clipMs: number | null = null, clipStartMs = 0) {
  const key = path ? `${path}#${clipStartMs}+${clipMs ?? "full"}` : null;
  const [state, setState] = useState<WaveformState>({ key: null, peaks: null, error: false });

  useEffect(() => {
    if (!key || !url) return;
    let cancelled = false;
    peaksFor(key, url, clipMs, clipStartMs).then(
      (peaks) => !cancelled && setState({ key, peaks, error: false }),
      () => !cancelled && setState({ key, peaks: null, error: true }),
    );
    return () => {
      cancelled = true;
    };
  }, [key, url, clipMs, clipStartMs]);

  const current = state.key === key ? state : { peaks: null, error: false };
  return { peaks: current.peaks, error: current.error };
}
