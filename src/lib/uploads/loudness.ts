export type Loudness = { lufs: number | null; truePeakDbtp: number | null };

type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };

const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_LU = -10;
const OVERSAMPLE = 4;
const TAPS_PER_PHASE = 12;
const SURROUND_WEIGHT = 1.41;

function highShelf(sampleRate: number): Biquad {
  const f0 = 1681.974450955533;
  const gainDb = 3.999843853973347;
  const q = 0.7071752369554196;
  const k = Math.tan((Math.PI * f0) / sampleRate);
  const vh = 10 ** (gainDb / 20);
  const vb = vh ** 0.4996667741545416;
  const a0 = 1 + k / q + k * k;
  return {
    b0: (vh + (vb * k) / q + k * k) / a0,
    b1: (2 * (k * k - vh)) / a0,
    b2: (vh - (vb * k) / q + k * k) / a0,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / q + k * k) / a0,
  };
}

function highPass(sampleRate: number): Biquad {
  const f0 = 38.13547087602444;
  const q = 0.5003270373238773;
  const k = Math.tan((Math.PI * f0) / sampleRate);
  const a0 = 1 + k / q + k * k;
  return { b0: 1, b1: -2, b2: 1, a1: (2 * (k * k - 1)) / a0, a2: (1 - k / q + k * k) / a0 };
}

function interpolationPhases(): Float64Array[] {
  const length = OVERSAMPLE * TAPS_PER_PHASE + 1;
  const center = (length - 1) / 2;
  const taps = Float64Array.from({ length }, (_, n) => {
    const x = (n - center) / OVERSAMPLE;
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const t = (2 * Math.PI * n) / (length - 1);
    const blackmanHarris = 0.35875 - 0.48829 * Math.cos(t) + 0.14128 * Math.cos(2 * t) - 0.01168 * Math.cos(3 * t);
    return sinc * blackmanHarris;
  });
  return Array.from({ length: OVERSAMPLE - 1 }, (_, i) => {
    const phase = i + 1;
    const coefficients: number[] = [];
    for (let n = phase; n < length; n += OVERSAMPLE) coefficients.push(taps[n]);
    const sum = coefficients.reduce((a, b) => a + b, 0);
    return Float64Array.from(coefficients, (c) => c / sum);
  });
}

const PHASES = interpolationPhases();
const PHASE_GAIN = Math.max(...PHASES.map((p) => p.reduce((a, c) => a + Math.abs(c), 0)));
const HISTORY = Math.max(...PHASES.map((p) => p.length));

export function channelWeights(channels: number): number[] {
  if (channels === 6) return [1, 1, 1, SURROUND_WEIGHT, SURROUND_WEIGHT, 0];
  if (channels === 5) return [1, 1, 1, SURROUND_WEIGHT, SURROUND_WEIGHT];
  return Array.from({ length: channels }, () => 1);
}

class ChannelState {
  readonly shelf = { x1: 0, x2: 0, y1: 0, y2: 0 };
  readonly pass = { x1: 0, x2: 0, y1: 0, y2: 0 };
  readonly history = new Float64Array(2 * HISTORY);
  historyIndex = 0;
  sinceLoud = Infinity;
}

export class LoudnessMeter {
  private readonly shelf: Biquad;
  private readonly pass: Biquad;
  private readonly weights: number[];
  private readonly states: ChannelState[];
  private readonly step: number;
  private readonly subBlocks: number[] = [];
  private readonly blockPowers: number[] = [];
  private subEnergy = 0;
  private subCount = 0;
  private peak = 0;

  constructor(
    readonly sampleRate: number,
    readonly channels: number,
  ) {
    this.shelf = highShelf(sampleRate);
    this.pass = highPass(sampleRate);
    this.weights = channelWeights(channels);
    this.states = Array.from({ length: channels }, () => new ChannelState());
    this.step = Math.max(1, Math.round(sampleRate / 10));
  }

  push(channelData: ArrayLike<number>[]): void {
    const frames = Math.min(...channelData.slice(0, this.channels).map((c) => c.length));
    if (!Number.isFinite(frames) || frames <= 0) return;
    const filtered = channelData.slice(0, this.channels).map((data, c) => this.filterChannel(data, c, frames));
    for (let i = 0; i < frames; i++) {
      let energy = 0;
      for (let c = 0; c < this.channels; c++) energy += this.weights[c] * filtered[c][i] * filtered[c][i];
      this.subEnergy += energy;
      if (++this.subCount === this.step) this.closeSubBlock();
    }
  }

  result(): Loudness {
    const truePeakDbtp = this.peak > 0 ? 20 * Math.log10(this.peak) : null;
    const absolute = this.blockPowers.filter((p) => toLufs(p) > ABSOLUTE_GATE_LUFS);
    if (absolute.length === 0) return { lufs: null, truePeakDbtp };
    const threshold = toLufs(mean(absolute)) + RELATIVE_GATE_LU;
    const gated = absolute.filter((p) => toLufs(p) > threshold);
    return { lufs: gated.length ? toLufs(mean(gated)) : null, truePeakDbtp };
  }

  private closeSubBlock() {
    this.subBlocks.push(this.subEnergy);
    this.subEnergy = 0;
    this.subCount = 0;
    if (this.subBlocks.length > 4) this.subBlocks.shift();
    if (this.subBlocks.length === 4) {
      this.blockPowers.push((this.subBlocks[0] + this.subBlocks[1] + this.subBlocks[2] + this.subBlocks[3]) / (4 * this.step));
    }
  }

  private filterChannel(data: ArrayLike<number>, channel: number, frames: number): Float64Array {
    const out = new Float64Array(frames);
    const state = this.states[channel];
    const s = this.shelf;
    const p = this.pass;
    const sh = state.shelf;
    const hp = state.pass;
    for (let i = 0; i < frames; i++) {
      const x = data[i];
      this.trackPeak(state, x);
      const y1 = s.b0 * x + s.b1 * sh.x1 + s.b2 * sh.x2 - s.a1 * sh.y1 - s.a2 * sh.y2;
      sh.x2 = sh.x1;
      sh.x1 = x;
      sh.y2 = sh.y1;
      sh.y1 = y1;
      const y2 = p.b0 * y1 + p.b1 * hp.x1 + p.b2 * hp.x2 - p.a1 * hp.y1 - p.a2 * hp.y2;
      hp.x2 = hp.x1;
      hp.x1 = y1;
      hp.y2 = hp.y1;
      hp.y1 = y2;
      out[i] = y2;
    }
    return out;
  }

  private trackPeak(state: ChannelState, x: number) {
    const magnitude = Math.abs(x);
    if (magnitude > this.peak) this.peak = magnitude;
    const history = state.history;
    const newest = state.historyIndex + HISTORY;
    history[state.historyIndex] = x;
    history[newest] = x;
    state.historyIndex = (state.historyIndex + 1) % HISTORY;
    state.sinceLoud = magnitude * PHASE_GAIN >= this.peak ? 0 : state.sinceLoud + 1;
    if (state.sinceLoud >= HISTORY) return;
    for (const phase of PHASES) {
      let y = 0;
      for (let k = 0; k < phase.length; k++) y += phase[k] * history[newest - k];
      const interpolated = Math.abs(y);
      if (interpolated > this.peak) this.peak = interpolated;
    }
  }
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function toLufs(power: number): number {
  return power > 0 ? -0.691 + 10 * Math.log10(power) : -Infinity;
}

export function measureLoudness(channelData: ArrayLike<number>[], sampleRate: number): Loudness {
  const meter = new LoudnessMeter(sampleRate, channelData.length);
  meter.push(channelData);
  return meter.result();
}
