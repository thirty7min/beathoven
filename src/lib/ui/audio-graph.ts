import { dbToGain } from "@/lib/audio/loudness-gain";
import { sharedAudioContext } from "./audio-unlock";

export type MediaGraph = {
  context: AudioContext;
  boost: GainNode;
  limiter: DynamicsCompressorNode;
  gain: GainNode;
  analyser: AnalyserNode;
  target: number;
  boostDb: number;
  limited: boolean;
};

const graphs = new WeakMap<HTMLMediaElement, MediaGraph>();

export const ANALYSER_FFT_SIZE = 2048;
export const LIMITER = { thresholdDb: -1.5, ratio: 20, attackS: 0.003, releaseS: 0.1, kneeDb: 0 } as const;
export const BOOST_RAMP_S = 0.05;
const GAIN_SMOOTHING_S = 0.03;

export type BoostPlan = { db: number; gain: number; limiter: boolean };

export function boostPlan(db: number | null | undefined): BoostPlan {
  const safe = db != null && Number.isFinite(db) && db > 0 ? db : 0;
  return { db: safe, gain: dbToGain(safe), limiter: safe > 0 };
}

export function connectMedia(element: HTMLMediaElement): MediaGraph | null {
  const existing = graphs.get(element);
  if (existing) return existing;
  const context = sharedAudioContext();
  if (!context) return null;
  try {
    const source = context.createMediaElementSource(element);
    const boost = context.createGain();
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = LIMITER.thresholdDb;
    limiter.ratio.value = LIMITER.ratio;
    limiter.attack.value = LIMITER.attackS;
    limiter.release.value = LIMITER.releaseS;
    limiter.knee.value = LIMITER.kneeDb;
    const gain = context.createGain();
    const analyser = context.createAnalyser();
    analyser.fftSize = ANALYSER_FFT_SIZE;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(boost).connect(gain).connect(analyser).connect(context.destination);
    limiter.connect(gain);
    const graph = { context, boost, limiter, gain, analyser, target: 1, boostDb: 0, limited: false };
    graphs.set(element, graph);
    return graph;
  } catch {
    return null;
  }
}

export function setGraphGain(graph: MediaGraph, value: number) {
  if (Math.abs(graph.target - value) < 0.001) return;
  graph.target = value;
  graph.gain.gain.setTargetAtTime(value, graph.context.currentTime, GAIN_SMOOTHING_S);
}

export function setGraphBoost(graph: MediaGraph, db: number | null | undefined) {
  const plan = boostPlan(db);
  if (Math.abs(graph.boostDb - plan.db) < 0.01 && graph.limited === plan.limiter) return;
  graph.boostDb = plan.db;
  graph.boost.gain.setTargetAtTime(plan.gain, graph.context.currentTime, BOOST_RAMP_S / 3);
  if (graph.limited === plan.limiter) return;
  graph.limited = plan.limiter;
  graph.boost.disconnect();
  graph.boost.connect(plan.limiter ? graph.limiter : graph.gain);
}

export function setMediaLevel(element: HTMLMediaElement, graph: MediaGraph | null, level: number, muted: boolean) {
  if (graph) {
    if (element.volume !== 1) element.volume = 1;
    if (element.muted) element.muted = false;
    setGraphGain(graph, muted ? 0 : level);
    return;
  }
  if (Math.abs(element.volume - level) > 0.001) element.volume = Math.min(1, Math.max(0, level));
  if (element.muted !== muted) element.muted = muted;
}
