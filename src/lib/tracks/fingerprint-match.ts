export const ITEM_SECONDS = 1365 / 11025;
export const MAX_OFFSET_ITEMS = 160;
export const AUTO_MATCH_BER = 0.15;
export const SUGGEST_BER = 0.25;
export const MIN_COVERAGE = 0.8;
export const MIN_OVERLAP_SECONDS = 30;
export const MIN_DIVERSITY = 0.1;
export const DURATION_TOLERANCE_MS = 20_000;
export const DURATION_TOLERANCE_RATIO = 0.15;

const ALIGN_BITS = 12;
const OFFSET_CANDIDATES = 5;

export type Comparison = {
  ber: number;
  offset: number;
  overlapItems: number;
  coverage: number;
  overlapSeconds: number;
};

export type MatchKind = "match" | "suggest" | "none";

export function durationsCompatible(aMs: number, bMs: number) {
  return Math.abs(aMs - bMs) <= Math.max(DURATION_TOLERANCE_MS, DURATION_TOLERANCE_RATIO * Math.max(aMs, bMs));
}

export function diversity(fingerprint: Uint32Array) {
  return fingerprint.length === 0 ? 0 : new Set(fingerprint).size / fingerprint.length;
}

function popcount(x: number) {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return Math.imul(x, 0x01010101) >>> 24;
}

function overlapRange(aLength: number, bLength: number, offset: number) {
  const start = Math.max(0, -offset);
  const end = Math.min(bLength, aLength - offset);
  return { start, end, items: Math.max(0, end - start) };
}

function bitErrorRate(a: Uint32Array, b: Uint32Array, offset: number) {
  const { start, end, items } = overlapRange(a.length, b.length, offset);
  if (items === 0) return 1;
  let errors = 0;
  for (let i = start; i < end; i++) errors += popcount(a[i + offset] ^ b[i]);
  return errors / (items * 32);
}

function rankOffsets(a: Uint32Array, b: Uint32Array) {
  const shift = 32 - ALIGN_BITS;
  const votes: { offset: number; votes: number }[] = [];
  for (let offset = -MAX_OFFSET_ITEMS; offset <= MAX_OFFSET_ITEMS; offset++) {
    const { start, end, items } = overlapRange(a.length, b.length, offset);
    if (items === 0) continue;
    let count = 0;
    for (let i = start; i < end; i++) if (a[i + offset] >>> shift === b[i] >>> shift) count++;
    votes.push({ offset, votes: count });
  }
  return votes.sort((x, y) => y.votes - x.votes || Math.abs(x.offset) - Math.abs(y.offset)).slice(0, OFFSET_CANDIDATES);
}

export function compareFingerprints(a: Uint32Array, b: Uint32Array): Comparison | null {
  if (a.length === 0 || b.length === 0) return null;
  let best: Comparison | null = null;
  for (const { offset } of rankOffsets(a, b)) {
    const ber = bitErrorRate(a, b, offset);
    if (best && ber >= best.ber) continue;
    const { items } = overlapRange(a.length, b.length, offset);
    best = {
      ber,
      offset,
      overlapItems: items,
      coverage: items / Math.min(a.length, b.length),
      overlapSeconds: items * ITEM_SECONDS,
    };
  }
  return best;
}

export function classifyComparison(comparison: Comparison | null): MatchKind {
  if (!comparison || comparison.coverage < MIN_COVERAGE || comparison.overlapSeconds < MIN_OVERLAP_SECONDS) return "none";
  if (comparison.ber <= AUTO_MATCH_BER) return "match";
  return comparison.ber <= SUGGEST_BER ? "suggest" : "none";
}

export type TrackCandidate = {
  trackId: string;
  durationMs: number;
  fingerprint: Uint32Array;
};

export type TrackChoice = {
  match: { trackId: string; ber: number } | null;
  suggestion: { trackId: string; ber: number } | null;
};

export function chooseTrack(fingerprint: Uint32Array, durationMs: number, candidates: TrackCandidate[]): TrackChoice {
  const choice: TrackChoice = { match: null, suggestion: null };
  if (diversity(fingerprint) < MIN_DIVERSITY) return choice;

  const bestByTrack = new Map<string, number>();
  for (const candidate of candidates) {
    if (!durationsCompatible(durationMs, candidate.durationMs) || diversity(candidate.fingerprint) < MIN_DIVERSITY) continue;
    const comparison = compareFingerprints(candidate.fingerprint, fingerprint);
    if (classifyComparison(comparison) === "none" || !comparison) continue;
    const previous = bestByTrack.get(candidate.trackId);
    if (previous === undefined || comparison.ber < previous) bestByTrack.set(candidate.trackId, comparison.ber);
  }

  let best: { trackId: string; ber: number } | null = null;
  for (const [trackId, ber] of bestByTrack) if (!best || ber < best.ber) best = { trackId, ber };
  if (!best) return choice;
  return best.ber <= AUTO_MATCH_BER ? { match: best, suggestion: null } : { match: null, suggestion: best };
}

export function encodeFingerprint(fingerprint: Uint32Array) {
  const bytes = new Uint8Array(fingerprint.length * 4);
  const view = new DataView(bytes.buffer);
  fingerprint.forEach((item, i) => view.setUint32(i * 4, item, true));
  return `\\x${Buffer.from(bytes).toString("hex")}`;
}

export function decodeFingerprint(hex: string): Uint32Array {
  const bytes = Buffer.from(hex.startsWith("\\x") ? hex.slice(2) : hex, "hex");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Uint32Array(Math.floor(bytes.byteLength / 4));
  for (let i = 0; i < out.length; i++) out[i] = view.getUint32(i * 4, true);
  return out;
}

export function parseFpcalcOutput(stdout: string): Uint32Array | null {
  try {
    const parsed = JSON.parse(stdout) as { fingerprint?: unknown };
    if (!Array.isArray(parsed.fingerprint) || parsed.fingerprint.length === 0) return null;
    if (!parsed.fingerprint.every((item) => Number.isInteger(item) && item >= 0 && item <= 0xffffffff)) return null;
    return Uint32Array.from(parsed.fingerprint as number[]);
  } catch {
    return null;
  }
}
