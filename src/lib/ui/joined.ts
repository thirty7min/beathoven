export function joinedLabel(createdAt: string): string | null {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return `Joined ${date.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}`;
}
