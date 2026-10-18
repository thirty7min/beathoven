const REVOKE_DELAY_MS = 1_000;

const urls = new WeakMap<Blob, string>();
const pending = new Map<string, ReturnType<typeof setTimeout>>();

export function objectUrlFor(blob: Blob): string {
  const existing = urls.get(blob);
  if (existing) return existing;
  const url = URL.createObjectURL(blob);
  urls.set(blob, url);
  return url;
}

export function retainObjectUrl(url: string) {
  const timer = pending.get(url);
  if (timer === undefined) return;
  clearTimeout(timer);
  pending.delete(url);
}

export function releaseObjectUrl(blob: Blob, url: string) {
  retainObjectUrl(url);
  pending.set(
    url,
    setTimeout(() => {
      pending.delete(url);
      if (urls.get(blob) === url) urls.delete(blob);
      URL.revokeObjectURL(url);
    }, REVOKE_DELAY_MS),
  );
}
