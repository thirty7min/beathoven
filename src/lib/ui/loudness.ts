import { boostGainDb, dbToGain } from "@/lib/audio/loudness-gain";
import { LOUDNESS_BOOST_ENABLED } from "@/lib/features";
import type { PlaybackLoudness } from "@/lib/game/types";

export function playbackBoostDb(entry: Partial<PlaybackLoudness> | null | undefined, enabled = entry?.loudness_boost): number {
  if (!LOUDNESS_BOOST_ENABLED) return 0;
  return boostGainDb({ lufs: entry?.loudness_lufs, truePeakDbtp: entry?.true_peak_dbtp, enabled });
}

export const MIN_WAVE_SCALE = 0.25;

export function waveformBoostScale(boostDb: number, enabled: boolean): number {
  if (enabled || !Number.isFinite(boostDb) || boostDb <= 0) return 1;
  return Math.max(MIN_WAVE_SCALE, 1 / dbToGain(boostDb));
}
