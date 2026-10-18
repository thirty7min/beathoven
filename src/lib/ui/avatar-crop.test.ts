import { describe, expect, it } from "vitest";
import { clampOffset, clampZoom, coverScale, cropSource, validateAvatarFile, MAX_AVATAR_BYTES } from "./avatar-crop";

const landscape = { width: 800, height: 400 };

describe("validateAvatarFile", () => {
  it("accepts the supported image types up to 5 MB", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp", "image/gif"]) expect(validateAvatarFile({ type, size: 1000 })).toBeNull();
    expect(validateAvatarFile({ type: "image/png", size: MAX_AVATAR_BYTES })).toBeNull();
  });

  it("rejects SVG, other files and oversized images", () => {
    expect(validateAvatarFile({ type: "image/svg+xml", size: 10 })).not.toBeNull();
    expect(validateAvatarFile({ type: "application/pdf", size: 10 })).not.toBeNull();
    expect(validateAvatarFile({ type: "image/png", size: MAX_AVATAR_BYTES + 1 })).not.toBeNull();
  });
});

describe("crop math", () => {
  it("covers the viewport with the short side", () => {
    expect(coverScale(landscape, 200)).toBe(0.5);
    expect(clampZoom(0.5)).toBe(1);
    expect(clampZoom(9)).toBe(3);
  });

  it("keeps the image covering the viewport while dragging", () => {
    expect(clampOffset({ x: 500, y: 50 }, landscape, 200, 1)).toEqual({ x: 100, y: 0 });
    expect(clampOffset({ x: -500, y: -500 }, landscape, 200, 2)).toEqual({ x: -300, y: -100 });
  });

  it("crops the centre square by default", () => {
    expect(cropSource(landscape, 200, 1, { x: 0, y: 0 })).toEqual({ x: 200, y: 0, size: 400 });
  });

  it("follows the drag and zoom", () => {
    expect(cropSource(landscape, 200, 1, { x: 100, y: 0 })).toEqual({ x: 0, y: 0, size: 400 });
    expect(cropSource(landscape, 200, 2, { x: 0, y: 0 })).toEqual({ x: 300, y: 100, size: 200 });
  });
});
