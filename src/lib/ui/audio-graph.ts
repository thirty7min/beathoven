import { sharedAudioContext } from "./audio-unlock";

export type MediaGraph = { context: AudioContext; gain: GainNode; analyser: AnalyserNode; target: number };

const graphs = new WeakMap<HTMLMediaElement, MediaGraph>();

export const ANALYSER_FFT_SIZE = 2048;
const GAIN_SMOOTHING_S = 0.03;

export function connectMedia(element: HTMLMediaElement): MediaGraph | null {
  const existing = graphs.get(element);
  if (existing) return existing;
  const context = sharedAudioContext();
  if (!context) return null;
  try {
    const source = context.createMediaElementSource(element);
    const gain = context.createGain();
    const analyser = context.createAnalyser();
    analyser.fftSize = ANALYSER_FFT_SIZE;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(gain).connect(analyser).connect(context.destination);
    const graph = { context, gain, analyser, target: 1 };
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
