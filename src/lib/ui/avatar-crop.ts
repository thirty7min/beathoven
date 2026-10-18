export const AVATAR_OUTPUT_PX = 256;
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
export const MAX_ZOOM = 3;
export const AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const AVATAR_ACCEPT = AVATAR_TYPES.join(",");

export type Size = { width: number; height: number };
export type Offset = { x: number; y: number };

export function validateAvatarFile(file: { type: string; size: number }): string | null {
  if (!(AVATAR_TYPES as readonly string[]).includes(file.type)) return "Use a PNG, JPEG, WebP or GIF image.";
  if (file.size > MAX_AVATAR_BYTES) return "Images can be at most 5 MB.";
  return null;
}

export function coverScale(image: Size, view: number): number {
  return view / Math.min(image.width, image.height);
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(1, zoom));
}

export function clampOffset(offset: Offset, image: Size, view: number, zoom: number): Offset {
  const scale = coverScale(image, view) * clampZoom(zoom);
  const maxX = Math.max(0, (image.width * scale - view) / 2);
  const maxY = Math.max(0, (image.height * scale - view) / 2);
  return { x: Math.min(maxX, Math.max(-maxX, offset.x)), y: Math.min(maxY, Math.max(-maxY, offset.y)) };
}

export function cropSource(image: Size, view: number, zoom: number, offset: Offset): { x: number; y: number; size: number } {
  const scale = coverScale(image, view) * clampZoom(zoom);
  const { x, y } = clampOffset(offset, image, view, zoom);
  return {
    x: (image.width * scale - view) / 2 / scale - x / scale,
    y: (image.height * scale - view) / 2 / scale - y / scale,
    size: view / scale,
  };
}
