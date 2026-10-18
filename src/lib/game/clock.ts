export type ClockSample = { offsetMs: number; rttMs: number };

/** NTP-style estimate assuming the server stamped its time halfway through the round trip. */
export function clockSample(sentAt: number, serverTime: number, receivedAt: number): ClockSample {
  const rttMs = Math.max(0, receivedAt - sentAt);
  return { rttMs, offsetMs: serverTime - (sentAt + rttMs / 2) };
}

/** The lowest-latency sample has the tightest error bound (±rtt/2). */
export function bestOffset(samples: ClockSample[]): number | null {
  if (samples.length === 0) return null;
  return samples.reduce((best, s) => (s.rttMs < best.rttMs ? s : best)).offsetMs;
}

export class ServerClock {
  private samples: ClockSample[] = [];
  private offsetMs = 0;

  constructor(
    private readonly localNow: () => number = Date.now,
    private readonly maxSamples = 10,
  ) {}

  get offset(): number {
    return this.offsetMs;
  }

  get synced(): boolean {
    return this.samples.length > 0;
  }

  add(sample: ClockSample): void {
    this.samples = [...this.samples, sample].slice(-this.maxSamples);
    this.offsetMs = bestOffset(this.samples) ?? 0;
  }

  now(): number {
    return this.localNow() + this.offsetMs;
  }

  toLocal(serverMs: number): number {
    return serverMs - this.offsetMs;
  }

  async sync(fetchServerTime: () => Promise<string>, rounds = 5): Promise<void> {
    for (let i = 0; i < rounds; i++) {
      const sentAt = this.localNow();
      const server = Date.parse(await fetchServerTime());
      const receivedAt = this.localNow();
      if (!Number.isNaN(server)) this.add(clockSample(sentAt, server, receivedAt));
    }
  }
}
