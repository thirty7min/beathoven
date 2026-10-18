import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { changelogSection } from "./changelog.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];
if (!version) {
  console.error("usage: node scripts/release-notes.mjs <version>");
  process.exit(1);
}

console.log(changelogSection(readFileSync(join(root, "CHANGELOG.md"), "utf8"), version));
