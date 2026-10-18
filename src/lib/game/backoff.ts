export function backoffDelay(attempt: number, baseMs = 1000, maxMs = 15_000): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
}

export class Backoff {
  private attempt = 0;

  constructor(
    private readonly baseMs = 1000,
    private readonly maxMs = 15_000,
  ) {}

  next(): number {
    return backoffDelay(this.attempt++, this.baseMs, this.maxMs);
  }

  reset(): void {
    this.attempt = 0;
  }
}
