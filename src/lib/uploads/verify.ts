import { createHash } from "node:crypto";
import { verifyAudio, type VerifiedAudio } from "./audio";
import { verifyAvatar, type VerifiedAvatar } from "./avatar";
import { reject, type Rejected } from "./reasons";

export type UploadKind = "submission" | "avatar";

type Fingerprint = { sha256: string; size: number };

export type Verdict =
  | (VerifiedAudio & Fingerprint)
  | (VerifiedAvatar & Fingerprint)
  | (Rejected & Partial<Fingerprint>);

export const sha256Hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export async function verifyUpload(
  kind: UploadKind,
  input: Uint8Array,
  isBlocked: (sha256: string) => Promise<boolean>,
): Promise<Verdict> {
  const fingerprint = { sha256: sha256Hex(input), size: input.byteLength };
  if (await isBlocked(fingerprint.sha256)) return { ...reject("blocked_file"), ...fingerprint };
  const result = kind === "submission" ? await verifyAudio(input) : await verifyAvatar(input);
  return { ...result, ...fingerprint };
}
