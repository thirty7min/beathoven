import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "1.6.2";
const TARGET = "linux-x86_64";
const SHA256 = "c968ad4a0821592a79b158fb2e1f46cbe0a22a0a1dbc0743c67d68e75d15d2bb";
const URL = `https://github.com/acoustid/chromaprint/releases/download/v${VERSION}/chromaprint-fpcalc-${VERSION}-${TARGET}.tar.gz`;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "vendor", "fpcalc", TARGET);
const binary = join(dest, "fpcalc");
const stamp = join(dest, "VERSION");

const wanted = process.argv.includes("--force") || process.env.VERCEL || (process.platform === "linux" && process.arch === "x64");
if (!wanted) {
  console.log(`fpcalc: skipping ${TARGET} download on ${process.platform}-${process.arch} (use --force to fetch anyway)`);
  process.exit(0);
}
if (existsSync(binary) && existsSync(stamp) && readFileSync(stamp, "utf8").trim() === VERSION) {
  console.log(`fpcalc: ${VERSION} already in ${dest}`);
  process.exit(0);
}

const response = await fetch(URL);
if (!response.ok) throw new Error(`fpcalc: download failed with ${response.status}`);
const archive = Buffer.from(await response.arrayBuffer());
const digest = createHash("sha256").update(archive).digest("hex");
if (digest !== SHA256) throw new Error(`fpcalc: checksum mismatch (${digest})`);

const work = mkdtempSync(join(tmpdir(), "fpcalc-"));
try {
  writeFileSync(join(work, "fpcalc.tar.gz"), archive);
  const untar = spawnSync("tar", ["-xzf", "fpcalc.tar.gz"], { cwd: work, stdio: "inherit" });
  if (untar.status !== 0) throw new Error("fpcalc: could not extract the archive");
  mkdirSync(dest, { recursive: true });
  copyFileSync(join(work, `chromaprint-fpcalc-${VERSION}-${TARGET}`, "fpcalc"), binary);
  chmodSync(binary, 0o755);
  copyFileSync(join(root, "scripts", "fpcalc-NOTICE.txt"), join(dest, "NOTICE.txt"));
  writeFileSync(stamp, `${VERSION}\n`);
  console.log(`fpcalc: installed ${VERSION} into ${dest}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
