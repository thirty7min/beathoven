import { describe, expect, it } from "vitest";
import { LoudnessMeter, channelWeights, measureLoudness } from "./loudness";

const sine = (sampleRate: number, seconds: number, dbfs: number, frequency = 1000, phase = 0) => {
  const amplitude = 10 ** (dbfs / 20);
  return Float32Array.from({ length: Math.round(sampleRate * seconds) }, (_, i) =>
    amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate + phase),
  );
};

const concat = (...parts: Float32Array[]) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

describe("integrated loudness", () => {
  it.each([48_000, 44_100])("reads a stereo 1 kHz sine at -20 dBFS as -20 LUFS at %i Hz", (rate) => {
    const tone = sine(rate, 10, -20);
    const { lufs } = measureLoudness([tone, tone], rate);
    expect(lufs!).toBeGreaterThan(-20.5);
    expect(lufs!).toBeLessThan(-19.5);
  });

  it("reads a 0 dBFS sine in one channel of a stereo pair as about -3 LUFS", () => {
    const tone = sine(48_000, 5, 0);
    expect(measureLoudness([tone, new Float32Array(tone.length)], 48_000).lufs!).toBeCloseTo(-3.01, 0);
  });

  it("gives the same answer when fed in uneven chunks", () => {
    const tone = sine(44_100, 6, -18, 440);
    const meter = new LoudnessMeter(44_100, 1);
    for (let offset = 0; offset < tone.length; offset += 1_237) meter.push([tone.subarray(offset, offset + 1_237)]);
    expect(meter.result().lufs!).toBeCloseTo(measureLoudness([tone], 44_100).lufs!, 6);
  });

  it("ignores silence below the absolute gate", () => {
    const rate = 48_000;
    const signal = concat(sine(rate, 10, -20), new Float32Array(rate * 20));
    expect(measureLoudness([signal, signal], rate).lufs!).toBeCloseTo(-20, 0);
    expect(measureLoudness([new Float32Array(rate * 5)], rate)).toEqual({ lufs: null, truePeakDbtp: null });
  });

  it("drops quiet passages more than 10 LU below the loud ones", () => {
    const rate = 48_000;
    const signal = concat(sine(rate, 10, -20), sine(rate, 10, -40));
    const { lufs } = measureLoudness([signal, signal], rate);
    expect(lufs!).toBeGreaterThan(-20.5);
    expect(lufs!).toBeLessThan(-19.5);
  });

  it("weights surround channels and drops LFE", () => {
    expect(channelWeights(2)).toEqual([1, 1]);
    expect(channelWeights(6)).toEqual([1, 1, 1, 1.41, 1.41, 0]);
  });
});

describe("true peak", () => {
  it("finds the inter-sample peak of a quarter-rate sine sampled off its crests", () => {
    const rate = 48_000;
    const tone = sine(rate, 1, 0, rate / 4, Math.PI / 4);
    const samplePeak = 20 * Math.log10(Math.max(...tone.map(Math.abs)));
    expect(samplePeak).toBeCloseTo(-3.01, 1);
    const { truePeakDbtp } = measureLoudness([tone], rate);
    expect(truePeakDbtp!).toBeGreaterThan(-0.2);
    expect(truePeakDbtp!).toBeLessThan(0.2);
  });

  it("matches the sample peak for slow signals", () => {
    const tone = sine(48_000, 1, -6, 100);
    expect(measureLoudness([tone], 48_000).truePeakDbtp!).toBeCloseTo(-6, 1);
  });
});
