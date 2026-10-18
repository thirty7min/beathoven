import { describe, expect, it } from "vitest";
import { ServerClock, bestOffset, clockSample } from "./clock";

describe("clockSample", () => {
  it("assumes the server stamped halfway through the round trip", () => {
    expect(clockSample(1000, 6050, 1100)).toEqual({ rttMs: 100, offsetMs: 5000 });
  });
});

describe("bestOffset", () => {
  it("uses the lowest-latency sample", () => {
    expect(
      bestOffset([
        { rttMs: 300, offsetMs: 900 },
        { rttMs: 20, offsetMs: 1000 },
        { rttMs: 150, offsetMs: 1100 },
      ]),
    ).toBe(1000);
    expect(bestOffset([])).toBeNull();
  });
});

describe("ServerClock", () => {
  it("syncs against a server that is ahead and converts between clocks", async () => {
    let local = 10_000;
    const clock = new ServerClock(() => local);
    const serverAhead = 2_000;
    const latencies = [80, 20, 200];
    let call = 0;
    await clock.sync(async () => {
      const rtt = latencies[call++ % latencies.length];
      local += rtt / 2;
      const server = new Date(local + serverAhead).toISOString();
      local += rtt / 2;
      return server;
    }, 3);
    expect(clock.synced).toBe(true);
    expect(clock.offset).toBe(serverAhead);
    expect(clock.now()).toBe(local + serverAhead);
    expect(clock.toLocal(clock.now())).toBe(local);
  });

  it("keeps a bounded window of samples", () => {
    const clock = new ServerClock(() => 0, 2);
    clock.add({ rttMs: 1, offsetMs: 1 });
    clock.add({ rttMs: 50, offsetMs: 2 });
    clock.add({ rttMs: 60, offsetMs: 3 });
    expect(clock.offset).toBe(2);
  });
});
