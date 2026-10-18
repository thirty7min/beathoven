export type TrackLoudness = { lufs: number | null | undefined; truePeakDbtp: number | null | undefined; enabled: boolean | null | undefined };
export type BoostOptions = { targetLufs?: number; ceilingDbtp?: number; maxBoostDb?: number };

export const BOOST_TARGET_LUFS = -14;
export const BOOST_CEILING_DBTP = -1;
export const MAX_BOOST_DB = 12;

export function boostGainDb(
  { lufs, truePeakDbtp, enabled }: TrackLoudness,
  { targetLufs = BOOST_TARGET_LUFS, ceilingDbtp = BOOST_CEILING_DBTP, maxBoostDb = MAX_BOOST_DB }: BoostOptions = {},
): number {
  if (!enabled || lufs == null || truePeakDbtp == null || !Number.isFinite(lufs) || !Number.isFinite(truePeakDbtp)) return 0;
  const wanted = targetLufs - lufs;
  if (wanted <= 0) return 0;
  return Math.max(0, Math.min(wanted, maxBoostDb, ceilingDbtp - truePeakDbtp));
}

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}
