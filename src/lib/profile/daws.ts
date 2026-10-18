export const DAWS = [
  { slug: "ableton-live", name: "Ableton Live" },
  { slug: "fl-studio", name: "FL Studio" },
  { slug: "logic-pro", name: "Logic Pro" },
  { slug: "pro-tools", name: "Pro Tools" },
  { slug: "cubase", name: "Cubase" },
  { slug: "studio-one", name: "Studio One" },
  { slug: "bitwig-studio", name: "Bitwig Studio" },
  { slug: "reaper", name: "REAPER" },
  { slug: "reason", name: "Reason" },
  { slug: "garageband", name: "GarageBand" },
  { slug: "bandlab", name: "BandLab" },
  { slug: "maschine", name: "Maschine" },
  { slug: "mpc", name: "MPC" },
  { slug: "cakewalk", name: "Cakewalk" },
  { slug: "renoise", name: "Renoise" },
  { slug: "lmms", name: "LMMS" },
  { slug: "ardour", name: "Ardour" },
] as const;

export type DawSlug = (typeof DAWS)[number]["slug"];

export const MAX_DAWS = 3;

const DAW_SLUGS: ReadonlySet<string> = new Set(DAWS.map((d) => d.slug));

export function isDawSlug(value: unknown): value is DawSlug {
  return typeof value === "string" && DAW_SLUGS.has(value);
}
