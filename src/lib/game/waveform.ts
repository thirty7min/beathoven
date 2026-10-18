export const WAVEFORM_BARS = 200;

const MAX_READS_PER_BAR = 4096;

export function downsamplePeaks(channels: ArrayLike<number>[], bars = WAVEFORM_BARS): number[] {
  const length = channels.length ? Math.min(...channels.map((c) => c.length)) : 0;
  const count = Math.min(Math.max(0, Math.floor(bars)), length);
  if (count === 0) return [];

  const peaks = new Array<number>(count).fill(0);
  for (let bar = 0; bar < count; bar++) {
    const start = Math.floor((bar * length) / count);
    const end = Math.max(start + 1, Math.floor(((bar + 1) * length) / count));
    const stride = Math.max(1, Math.floor((end - start) / MAX_READS_PER_BAR));
    let peak = 0;
    for (const channel of channels) {
      for (let i = start; i < end; i += stride) {
        const value = Math.abs(channel[i]);
        if (value > peak) peak = value;
      }
    }
    peaks[bar] = peak;
  }

  const loudest = Math.max(...peaks);
  return loudest > 0 ? peaks.map((p) => p / loudest) : peaks;
}

export function playedBars(total: number, progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.round(Math.min(1, Math.max(0, progress)) * total);
}

export function resamplePeaks(peaks: number[], bars: number): number[] {
  if (peaks.length <= bars) return peaks;
  return Array.from({ length: bars }, (_, bar) => {
    const start = Math.floor((bar * peaks.length) / bars);
    const end = Math.max(start + 1, Math.floor(((bar + 1) * peaks.length) / bars));
    return Math.max(...peaks.slice(start, end));
  });
}
