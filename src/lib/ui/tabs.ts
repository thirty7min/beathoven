export function nextTabIndex(key: string, current: number, count: number): number | null {
  if (count === 0) return null;
  const from = current < 0 ? 0 : current;
  switch (key) {
    case "ArrowRight":
      return (from + 1) % count;
    case "ArrowLeft":
      return (from - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
