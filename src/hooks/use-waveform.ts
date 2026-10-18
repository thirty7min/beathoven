"use client";

import { useEffect, useState } from "react";
import { downsamplePeaks } from "@/lib/game/waveform";

const cache = new Map<string, Promise<number[]>>();

async function decodePeaks(url: string, clipMs: number | null): Promise<number[]> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Couldn't fetch audio (${response.status})`);
  const data = await response.arrayBuffer();
  const context = new OfflineAudioContext(1, 1, 44_100);
  const buffer = await context.decodeAudioData(data);
  const frames = clipMs === null ? buffer.length : Math.min(buffer.length, Math.round((clipMs / 1000) * buffer.sampleRate));
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i).subarray(0, frames));
  return downsamplePeaks(channels);
}

function peaksFor(key: string, url: string, clipMs: number | null): Promise<number[]> {
  const hit = cache.get(key);
  if (hit) return hit;
  const promise = decodePeaks(url, clipMs);
  promise.catch(() => cache.delete(key));
  cache.set(key, promise);
  return promise;
}

type WaveformState = { key: string | null; peaks: number[] | null; error: boolean };

export function useWaveform(path: string | null | undefined, url: string | null, clipMs: number | null = null) {
  const key = path ? `${path}#${clipMs ?? "full"}` : null;
  const [state, setState] = useState<WaveformState>({ key: null, peaks: null, error: false });

  useEffect(() => {
    if (!key || !url) return;
    let cancelled = false;
    peaksFor(key, url, clipMs).then(
      (peaks) => !cancelled && setState({ key, peaks, error: false }),
      () => !cancelled && setState({ key, peaks: null, error: true }),
    );
    return () => {
      cancelled = true;
    };
  }, [key, url, clipMs]);

  const current = state.key === key ? state : { peaks: null, error: false };
  return { peaks: current.peaks, error: current.error };
}
