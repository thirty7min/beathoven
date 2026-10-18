import "server-only";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, chmod, constants, copyFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFpcalcOutput } from "./fingerprint-match";

const TIMEOUT_MS = 60_000;
const MAX_STDOUT_BYTES = 4 * 1024 * 1024;
const BUNDLED_TARGETS: Record<string, string> = { "linux-x64": "linux-x86_64" };

export class FpcalcUnavailableError extends Error {}

let resolved: Promise<string> | null = null;

async function executable(path: string) {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveBinary(): Promise<string> {
  if (process.env.FPCALC_PATH) return process.env.FPCALC_PATH;
  const target = BUNDLED_TARGETS[`${process.platform}-${process.arch}`];
  if (!target) return "fpcalc";
  const bundled = join(process.cwd(), "vendor", "fpcalc", target, "fpcalc");
  if (await executable(bundled)) return bundled;
  try {
    await access(bundled, constants.R_OK);
  } catch {
    return "fpcalc";
  }
  // Deployment bundles can drop the executable bit, and the bundle itself is read-only.
  const copy = join(tmpdir(), `fpcalc-${process.pid}`);
  await copyFile(bundled, copy);
  await chmod(copy, 0o755);
  return copy;
}

export function fpcalcBinary() {
  resolved ??= resolveBinary().catch((error) => {
    resolved = null;
    throw error;
  });
  return resolved;
}

function run(binary: string, file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ["-raw", "-json", "-length", "0", "-algorithm", "2", file], {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    const chunks: Buffer[] = [];
    let size = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > MAX_STDOUT_BYTES) child.kill("SIGKILL");
      else chunks.push(chunk);
    });
    child.on("error", (error: NodeJS.ErrnoException) =>
      reject(error.code === "ENOENT" ? new FpcalcUnavailableError(`fpcalc not found at ${binary}`) : error),
    );
    child.on("close", (code) => {
      if (code === 0 && size <= MAX_STDOUT_BYTES) resolve(Buffer.concat(chunks).toString("utf8"));
      else reject(new Error(`fpcalc exited with ${code ?? "signal"}`));
    });
  });
}

export async function fingerprintAudio(bytes: Uint8Array, ext: string): Promise<Uint32Array> {
  const binary = await fpcalcBinary();
  const file = join(tmpdir(), `fp-${randomUUID()}.${ext.replace(/[^a-z0-9]/gi, "") || "bin"}`);
  await writeFile(file, bytes);
  try {
    const fingerprint = parseFpcalcOutput(await run(binary, file));
    if (!fingerprint) throw new Error("fpcalc returned no fingerprint");
    return fingerprint;
  } finally {
    await rm(file, { force: true });
  }
}
