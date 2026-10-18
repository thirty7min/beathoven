export const HEADLINE_CHAR_EM = 0.64;

export type FitOptions = { minRem: number; maxRem: number; capCqi: number; share?: number; singleLine?: boolean; extraEm?: number };

export function longestWordLength(texts: string[]): number {
  return Math.max(1, ...texts.flatMap((t) => t.split(/\s+/)).map((w) => [...w].length));
}

export function fitFontSize(texts: string[], { minRem, maxRem, capCqi, share = 1, singleLine = false, extraEm = 0 }: FitOptions): string {
  const chars = singleLine ? Math.max(1, ...texts.map((t) => [...t].length)) : longestWordLength(texts);
  const fit = Math.round(((share * 100) / (chars * HEADLINE_CHAR_EM + extraEm)) * 100) / 100;
  return `clamp(${minRem}rem, min(${fit}cqi, ${capCqi}cqi), ${maxRem}rem)`;
}

export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} & ${names.at(-1)}`;
}
