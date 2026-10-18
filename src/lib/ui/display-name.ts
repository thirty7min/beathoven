type Named = { display_name?: string | null; username?: string | null } | null | undefined;

export function displayName(person: Named, fallback = "Unknown player"): string {
  const display = person?.display_name?.trim();
  if (display) return display;
  return person?.username?.trim() || fallback;
}
