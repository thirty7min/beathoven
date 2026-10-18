import { describe, expect, it } from "vitest";
import { categoryLabel, groupSamples, sampleFileName } from "./samples";
import type { RoomAsset } from "./types";

const sample = (id: number, category: string, position: number): RoomAsset => ({
  kind: "sample",
  position,
  prompt: null,
  sample: { id, name: `s${id}`, storage_path: `kit/s${id}.wav`, category, bpm: null, musical_key: null, duration_ms: null },
});

describe("groupSamples", () => {
  it("groups by category in a producer-friendly order", () => {
    const groups = groupSamples([
      sample(1, "synth", 5),
      sample(2, "kick", 0),
      sample(3, "synth", 4),
      sample(4, "808", 3),
      sample(5, "weird", 7),
      sample(6, "hihat", 2),
    ]);
    expect(groups.map((g) => g.category)).toEqual(["kick", "hihat", "808", "synth", "weird"]);
    expect(groups[3].samples.map((s) => s.id)).toEqual([3, 1]);
    expect(groups[4].label).toBe("Weird");
  });

  it("ignores prompts and returns nothing for an empty pool", () => {
    expect(groupSamples([])).toEqual([]);
    expect(groupSamples([{ kind: "prompt", position: 0, prompt: "x", sample: null }])).toEqual([]);
  });
});

describe("samples", () => {
  it("labels categories", () => {
    expect(categoryLabel("hihat")).toBe("Hi-hat");
    expect(categoryLabel("808")).toBe("808");
  });

  it("builds a safe download file name", () => {
    expect(sampleFileName({ name: "Dusty Kick", storage_path: "kits/a/kick_01.WAV" })).toBe("Dusty Kick.wav");
    expect(sampleFileName({ name: "pad.wav", storage_path: "x/pad.wav" })).toBe("pad.wav");
    expect(sampleFileName({ name: 'a/b:"c"', storage_path: "noext" })).toBe("abc");
  });
});
