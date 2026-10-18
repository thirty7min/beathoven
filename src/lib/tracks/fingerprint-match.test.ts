import { describe, expect, it } from "vitest";
import fixtures from "./fixtures/fpcalc-synthetic.json";
import {
  ITEM_SECONDS,
  chooseTrack,
  classifyComparison,
  compareFingerprints,
  decodeFingerprint,
  diversity,
  durationsCompatible,
  encodeFingerprint,
  parseFpcalcOutput,
} from "./fingerprint-match";

function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s;
  };
}

const items = (seconds: number) => Math.round(seconds / ITEM_SECONDS);

function randomFingerprint(seconds: number, seed: number) {
  const next = random(seed);
  return Uint32Array.from({ length: items(seconds) }, () => next());
}

function flipBits(fingerprint: Uint32Array, rate: number, seed: number) {
  const next = random(seed);
  return fingerprint.map((item) => {
    let mask = 0;
    for (let bit = 0; bit < 32; bit++) if (next() / 4294967296 < rate) mask |= 1 << bit;
    return (item ^ mask) >>> 0;
  });
}

const real = (key: keyof typeof fixtures) => ({
  fingerprint: Uint32Array.from(fixtures[key].fingerprint),
  durationMs: fixtures[key].duration_ms,
});

describe("compareFingerprints", () => {
  const base = randomFingerprint(120, 1);

  it("scores identical fingerprints as a perfect match", () => {
    const result = compareFingerprints(base, base.slice());
    expect(result).toMatchObject({ ber: 0, offset: 0, coverage: 1 });
    expect(classifyComparison(result)).toBe("match");
  });

  it("finds the offset of a trimmed copy in either direction", () => {
    const trimmed = base.slice(80);
    expect(compareFingerprints(base, trimmed)).toMatchObject({ ber: 0, offset: 80, coverage: 1 });
    expect(compareFingerprints(trimmed, base)).toMatchObject({ ber: 0, offset: -80, coverage: 1 });
  });

  it("does not search beyond 160 items", () => {
    const result = compareFingerprints(base, base.slice(200));
    expect(result!.ber).toBeGreaterThan(0.4);
    expect(classifyComparison(result)).toBe("none");
  });

  it("measures bit error rate and classifies it into the three bands", () => {
    for (const [rate, kind] of [
      [0.05, "match"],
      [0.12, "match"],
      [0.2, "suggest"],
      [0.3, "none"],
    ] as const) {
      const result = compareFingerprints(base, flipBits(base, rate, 7));
      expect(result!.ber).toBeCloseTo(rate, 1);
      expect(classifyComparison(result), String(rate)).toBe(kind);
    }
  });

  it("puts unrelated fingerprints near 0.5", () => {
    const result = compareFingerprints(base, randomFingerprint(120, 2));
    expect(result!.ber).toBeGreaterThan(0.45);
    expect(classifyComparison(result)).toBe("none");
  });

  it("requires 80% coverage of the shorter fingerprint and 30 seconds of overlap", () => {
    const shortClip = base.slice(0, items(25));
    expect(classifyComparison(compareFingerprints(base, shortClip))).toBe("none");
    const minute = base.slice(0, items(60));
    const sharedTail = Uint32Array.from([...minute.slice(150), ...randomFingerprint(150 * ITEM_SECONDS, 3)]);
    const partial = compareFingerprints(minute, sharedTail);
    expect(partial).toMatchObject({ ber: 0, offset: 150 });
    expect(partial!.coverage).toBeLessThan(0.8);
    expect(partial!.overlapSeconds).toBeGreaterThan(30);
    expect(classifyComparison(partial)).toBe("none");
  });

  it("returns null for empty input", () => {
    expect(compareFingerprints(new Uint32Array(0), base)).toBeNull();
    expect(classifyComparison(null)).toBe("none");
  });
});

describe("durationsCompatible", () => {
  it("allows 20 seconds or 15%, whichever is larger", () => {
    expect(durationsCompatible(60_000, 80_000)).toBe(true);
    expect(durationsCompatible(60_000, 81_000)).toBe(false);
    expect(durationsCompatible(300_000, 345_000)).toBe(true);
    expect(durationsCompatible(300_000, 360_000)).toBe(false);
  });
});

describe("chooseTrack", () => {
  const song = randomFingerprint(120, 10);

  it("attaches to the best-scoring track only", () => {
    const choice = chooseTrack(song, 120_000, [
      { trackId: "close", durationMs: 120_000, fingerprint: flipBits(song, 0.1, 1) },
      { trackId: "closest", durationMs: 118_000, fingerprint: flipBits(song, 0.03, 2) },
      { trackId: "other", durationMs: 120_000, fingerprint: randomFingerprint(120, 11) },
    ]);
    expect(choice).toEqual({ match: { trackId: "closest", ber: expect.any(Number) }, suggestion: null });
  });

  it("uses the best submission within a track", () => {
    const choice = chooseTrack(song, 120_000, [
      { trackId: "t", durationMs: 120_000, fingerprint: flipBits(song, 0.2, 1) },
      { trackId: "t", durationMs: 120_000, fingerprint: flipBits(song, 0.05, 2) },
    ]);
    expect(choice.match?.trackId).toBe("t");
    expect(choice.match!.ber).toBeLessThan(0.1);
  });

  it("suggests in the 0.15 to 0.25 band", () => {
    const choice = chooseTrack(song, 120_000, [{ trackId: "maybe", durationMs: 120_000, fingerprint: flipBits(song, 0.2, 3) }]);
    expect(choice.match).toBeNull();
    expect(choice.suggestion?.trackId).toBe("maybe");
  });

  it("skips candidates outside the duration window", () => {
    expect(chooseTrack(song, 120_000, [{ trackId: "t", durationMs: 200_000, fingerprint: song }])).toEqual({
      match: null,
      suggestion: null,
    });
  });

  it("never matches repetitive, low-diversity fingerprints", () => {
    const constant = new Uint32Array(items(60)).fill(0x12345678);
    const alternating = Uint32Array.from({ length: items(60) }, (_, i) => (i % 2 ? 0xdeadbeef : 0x0badf00d));
    expect(diversity(constant)).toBeLessThan(0.01);
    expect(classifyComparison(compareFingerprints(constant, constant))).toBe("match");
    expect(chooseTrack(constant, 60_000, [{ trackId: "t", durationMs: 60_000, fingerprint: constant }]).match).toBeNull();
    expect(chooseTrack(alternating, 60_000, [{ trackId: "t", durationMs: 60_000, fingerprint: alternating }]).match).toBeNull();
    expect(chooseTrack(song, 120_000, [{ trackId: "t", durationMs: 120_000, fingerprint: constant }]).match).toBeNull();
  });
});

describe("real fpcalc output", () => {
  const original = real("original_wav");
  const match = (key: keyof typeof fixtures) => {
    const other = real(key);
    return chooseTrack(other.fingerprint, other.durationMs, [{ trackId: "original", ...original }]);
  };

  it("groups re-encodes and a trimmed, faded export", () => {
    expect(match("mp3_128").match?.trackId).toBe("original");
    expect(match("trimmed_faded_m4a").match?.trackId).toBe("original");
  });

  it("suggests a new melody over the same beat and rejects other songs", () => {
    expect(match("new_melody_wav")).toEqual({ match: null, suggestion: { trackId: "original", ber: expect.any(Number) } });
    expect(match("other_song_wav")).toEqual({ match: null, suggestion: null });
  });

  it("never groups silence with a pure tone", () => {
    const silence = real("silence_wav");
    const tone = real("tone_wav");
    expect(chooseTrack(tone.fingerprint, tone.durationMs, [{ trackId: "silence", ...silence }])).toEqual({
      match: null,
      suggestion: null,
    });
  });
});

describe("fingerprint encoding", () => {
  it("round-trips through Postgres bytea hex", () => {
    const fingerprint = Uint32Array.from([0, 1, 0xffffffff, 0x80000000, 3762462167]);
    const hex = encodeFingerprint(fingerprint);
    expect(hex).toMatch(/^\\x[0-9a-f]{40}$/);
    expect(decodeFingerprint(hex)).toEqual(fingerprint);
  });

  it("parses fpcalc JSON and rejects anything else", () => {
    expect(parseFpcalcOutput('{"duration": 1.5, "fingerprint": [1, 4294967295]}')).toEqual(Uint32Array.from([1, 4294967295]));
    expect(parseFpcalcOutput('{"fingerprint": []}')).toBeNull();
    expect(parseFpcalcOutput('{"fingerprint": [-1]}')).toBeNull();
    expect(parseFpcalcOutput('{"fingerprint": [1.5]}')).toBeNull();
    expect(parseFpcalcOutput("not json")).toBeNull();
  });
});
