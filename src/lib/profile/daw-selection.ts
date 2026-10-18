import { DAWS, MAX_DAWS, isDawSlug, type DawSlug } from "./daws";

const DAW_NAMES: ReadonlyMap<DawSlug, string> = new Map(DAWS.map((d) => [d.slug, d.name]));

export function dawName(slug: DawSlug): string {
  return DAW_NAMES.get(slug) ?? slug;
}

export function normalizeDaws(values: readonly unknown[] | null | undefined, max = MAX_DAWS): DawSlug[] {
  const picked: DawSlug[] = [];
  for (const value of values ?? []) {
    if (picked.length >= max) break;
    if (isDawSlug(value) && !picked.includes(value)) picked.push(value);
  }
  return picked;
}

export function canSelectDaw(selection: readonly DawSlug[], slug: DawSlug, max = MAX_DAWS): boolean {
  return selection.includes(slug) || selection.length < max;
}

export function toggleDaw(selection: readonly DawSlug[], slug: DawSlug, max = MAX_DAWS): DawSlug[] {
  const current = normalizeDaws(selection, max);
  if (current.includes(slug)) return current.filter((s) => s !== slug);
  if (current.length >= max) return current;
  return [...current, slug];
}
