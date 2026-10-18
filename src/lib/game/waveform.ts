export const ENVELOPE_BUCKETS = 1024;
export const RMS_WEIGHT = 0.7;
export const REFERENCE_PERCENTILE = 0.95;
export const HEIGHT_CURVE = 1.8;
export const MIN_BAR_HEIGHT = 0.06;
export const BAR_WIDTH_PX = 2;
export const BAR_GAP_PX = 1;

const MAX_READS_PER_BUCKET = 4096;

export function waveformEnvelope(channels: ArrayLike<number>[], buckets = ENVELOPE_BUCKETS): number[] {
  const length = channels.length ? Math.min(...channels.map((c) => c.length)) : 0;
  const count = Math.min(Math.max(0, Math.floor(buckets)), length);
  if (count === 0) return [];

  const levels = new Array<number>(count).fill(0);
  for (let bucket = 0; bucket < count; bucket++) {
    const start = Math.floor((bucket * length) / count);
    const end = Math.max(start + 1, Math.floor(((bucket + 1) * length) / count));
    const stride = Math.max(1, Math.floor((end - start) / MAX_READS_PER_BUCKET));
    let peak = 0;
    let squares = 0;
    let reads = 0;
    for (const channel of channels) {
      for (let i = start; i < end; i += stride) {
        const value = Math.abs(channel[i]);
        if (value > peak) peak = value;
        squares += value * value;
        reads++;
      }
    }
    const rms = reads ? Math.sqrt(squares / reads) : 0;
    levels[bucket] = RMS_WEIGHT * rms + (1 - RMS_WEIGHT) * peak;
  }
  return levels;
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * (sorted.length - 1)))];
}

export function shapeWaveform(levels: number[]): number[] {
  const reference = percentile(levels, REFERENCE_PERCENTILE);
  if (reference <= 0) return levels.map(() => MIN_BAR_HEIGHT);
  return levels.map((level) => {
    const relative = Math.min(1, Math.max(0, level / reference));
    return MIN_BAR_HEIGHT + (1 - MIN_BAR_HEIGHT) * Math.pow(relative, HEIGHT_CURVE);
  });
}

export function waveformHeights(channels: ArrayLike<number>[], buckets = ENVELOPE_BUCKETS): number[] {
  return shapeWaveform(waveformEnvelope(channels, buckets));
}

export function resampleHeights(heights: number[], bars: number): number[] {
  const count = Math.max(0, Math.floor(bars));
  if (count === 0 || heights.length === 0) return [];
  if (count === heights.length) return heights;
  if (count > heights.length) {
    if (heights.length === 1) return new Array<number>(count).fill(heights[0]);
    return Array.from({ length: count }, (_, bar) => {
      const position = (bar / (count - 1)) * (heights.length - 1);
      const left = Math.floor(position);
      const right = Math.min(heights.length - 1, left + 1);
      return heights[left] + (heights[right] - heights[left]) * (position - left);
    });
  }
  return Array.from({ length: count }, (_, bar) => {
    const start = Math.floor((bar * heights.length) / count);
    const end = Math.max(start + 1, Math.floor(((bar + 1) * heights.length) / count));
    let sum = 0;
    for (let i = start; i < end; i++) sum += heights[i];
    return sum / (end - start);
  });
}

export function barCount(widthPx: number): number {
  return Math.max(0, Math.floor((widthPx + BAR_GAP_PX) / (BAR_WIDTH_PX + BAR_GAP_PX)));
}

export function playedBars(total: number, progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.round(Math.min(1, Math.max(0, progress)) * total);
}
