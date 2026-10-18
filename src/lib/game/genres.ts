export const GENRES = [
  { slug: "all", label: "All genres" },
  { slug: "hip-hop", label: "Hip-Hop" },
  { slug: "trap", label: "Trap" },
  { slug: "drill", label: "Drill" },
  { slug: "rnb", label: "R&B" },
  { slug: "pop", label: "Pop" },
  { slug: "edm", label: "EDM" },
  { slug: "house", label: "House" },
  { slug: "dnb", label: "Drum & Bass" },
  { slug: "lofi", label: "Lo-fi" },
  { slug: "afro", label: "Afro" },
  { slug: "latin", label: "Latin" },
  { slug: "rock", label: "Rock" },
  { slug: "cinematic", label: "Cinematic" },
  { slug: "other", label: "Other" },
] as const;

export type Genre = (typeof GENRES)[number]["slug"];

export const DEFAULT_GENRE: Genre = "all";

export function isGenre(value: unknown): value is Genre {
  return GENRES.some((g) => g.slug === value);
}

export function genreLabel(genre: string | null | undefined): string {
  return GENRES.find((g) => g.slug === genre)?.label ?? GENRES[0].label;
}
