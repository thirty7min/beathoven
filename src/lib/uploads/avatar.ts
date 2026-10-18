import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { reject, type Rejected } from "./reasons";

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
export const AVATAR_SIZE = 256;
export const MAX_AVATAR_PIXELS = 40_000_000;

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "webp", "gif"]);
const SHARP_FORMATS = new Set(["png", "jpeg", "webp", "gif"]);

export type VerifiedAvatar = { ok: true; bytes: Uint8Array; ext: "webp"; mime: "image/webp" };

export async function verifyAvatar(input: Uint8Array): Promise<VerifiedAvatar | Rejected> {
  if (input.byteLength > MAX_AVATAR_BYTES) return reject("file_too_large");
  const detected = await fileTypeFromBuffer(input);
  if (!detected || !IMAGE_EXTENSIONS.has(detected.ext)) return reject("unsupported_image");

  try {
    const image = sharp(input, { limitInputPixels: MAX_AVATAR_PIXELS, animated: false, failOn: "error" });
    const meta = await image.metadata();
    if (!meta.format || !SHARP_FORMATS.has(meta.format)) return reject("unsupported_image");
    if (!meta.width || !meta.height) return reject("corrupt_file");
    if (meta.width * meta.height > MAX_AVATAR_PIXELS) return reject("file_too_large");
    const output = await image
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover" })
      .webp({ quality: 82 })
      .toBuffer();
    return { ok: true, bytes: new Uint8Array(output), ext: "webp", mime: "image/webp" };
  } catch (error) {
    return reject(/pixel limit/i.test((error as Error).message) ? "file_too_large" : "corrupt_file");
  }
}
