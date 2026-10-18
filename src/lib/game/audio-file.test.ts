import { describe, expect, it } from "vitest";
import {
  MAX_SUBMISSION_BYTES,
  audioContentType,
  formatBytes,
  formatDuration,
  validateAudioFile,
  validateDuration,
} from "./audio-file";

describe("audioContentType", () => {
  it("keeps an allowed browser type", () => {
    expect(audioContentType({ name: "beat.mp3", type: "audio/mpeg" })).toBe("audio/mpeg");
    expect(audioContentType({ name: "beat.WAV", type: "AUDIO/X-WAV" })).toBe("audio/x-wav");
  });

  it("falls back to the extension when the type is missing or nonstandard", () => {
    expect(audioContentType({ name: "beat.flac", type: "" })).toBe("audio/flac");
    expect(audioContentType({ name: "Beat.M4A", type: "audio/m4a" })).toBe("audio/mp4");
    expect(audioContentType({ name: "beat.mp3", type: "application/octet-stream" })).toBe("audio/mpeg");
  });

  it("rejects non-audio files", () => {
    expect(audioContentType({ name: "cover.png", type: "image/png" })).toBeNull();
    expect(audioContentType({ name: "noext", type: "" })).toBeNull();
    expect(audioContentType({ name: "project.flp", type: "" })).toBeNull();
  });
});

describe("validateAudioFile", () => {
  it("accepts a normal audio file", () => {
    expect(validateAudioFile({ name: "a.wav", type: "audio/wav", size: 1000 })).toBeNull();
  });

  it("enforces the bucket size limit", () => {
    expect(validateAudioFile({ name: "a.wav", type: "audio/wav", size: MAX_SUBMISSION_BYTES })).toBeNull();
    expect(validateAudioFile({ name: "a.wav", type: "audio/wav", size: MAX_SUBMISSION_BYTES + 1 })).toMatch(/limit/);
  });

  it("rejects empty and unsupported files", () => {
    expect(validateAudioFile({ name: "a.wav", type: "audio/wav", size: 0 })).toMatch(/empty/);
    expect(validateAudioFile({ name: "a.zip", type: "application/zip", size: 10 })).toMatch(/supported/);
  });
});

describe("validateDuration", () => {
  it("matches the 3s to 15min range the verifier allows", () => {
    expect(validateDuration(2999)).not.toBeNull();
    expect(validateDuration(3000)).toBeNull();
    expect(validateDuration(900_000)).toBeNull();
    expect(validateDuration(900_001)).not.toBeNull();
    expect(validateDuration(Number.NaN)).not.toBeNull();
    expect(validateDuration(Number.POSITIVE_INFINITY)).not.toBeNull();
  });
});

describe("formatting", () => {
  it("formats bytes and durations", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5.5 * 1024 * 1024)).toBe("5.5 MB");
    expect(formatBytes(50 * 1024 * 1024)).toBe("50 MB");
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(65_900)).toBe("1:05");
  });
});
