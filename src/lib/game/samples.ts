import type { RoomAsset, SampleAsset } from "./types";

const CATEGORY_ORDER = ["kick", "snare", "hihat", "808", "perc", "synth", "drums", "bass", "melody", "vocal", "loop", "fx"];

const CATEGORY_LABELS: Record<string, string> = {
  kick: "Kick",
  snare: "Snare",
  hihat: "Hi-hat",
  "808": "808",
  perc: "Percussion",
  synth: "Synths",
  drums: "Drums",
  bass: "Bass",
  melody: "Melody",
  vocal: "Vocals",
  loop: "Loops",
  fx: "FX",
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category.charAt(0).toUpperCase() + category.slice(1);
}

export type SampleGroup = { category: string; label: string; samples: SampleAsset[] };

export function groupSamples(assets: RoomAsset[]): SampleGroup[] {
  const groups = new Map<string, SampleAsset[]>();
  for (const asset of [...assets].sort((a, b) => a.position - b.position)) {
    if (asset.kind !== "sample" || !asset.sample) continue;
    const list = groups.get(asset.sample.category) ?? [];
    list.push(asset.sample);
    groups.set(asset.sample.category, list);
  }
  const rank = (c: string) => {
    const i = CATEGORY_ORDER.indexOf(c);
    return i === -1 ? CATEGORY_ORDER.length : i;
  };
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([category, samples]) => ({ category, label: categoryLabel(category), samples }));
}

export function sampleFileName(sample: Pick<SampleAsset, "name" | "storage_path">): string {
  const ext = sample.storage_path.includes(".") ? sample.storage_path.split(".").pop()!.toLowerCase() : "";
  const base = sample.name.replace(/[\\/:*?"<>|]+/g, "").trim() || "sample";
  return ext && !base.toLowerCase().endsWith(`.${ext}`) ? `${base}.${ext}` : base;
}
