import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bumpVersion, releaseChangelog } from "./changelog.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const packagePath = join(root, "package.json");
const changelogPath = join(root, "CHANGELOG.md");

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

const bump = process.argv[2];
if (!bump) fail("usage: pnpm release <patch|minor|major>");
if (git("status", "--porcelain")) fail("working tree is dirty; commit or stash first");
if (git("branch", "--show-current") !== "main") fail("releases are cut from main");

const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
let version;
let changelog;
try {
  version = bumpVersion(pkg.version, bump);
  changelog = releaseChangelog(readFileSync(changelogPath, "utf8"), version, new Date().toLocaleDateString("en-CA"));
} catch (error) {
  fail(error.message);
}
const tag = `v${version}`;
if (git("tag", "--list", tag)) fail(`tag ${tag} already exists`);

writeFileSync(packagePath, `${JSON.stringify({ ...pkg, version }, null, 2)}\n`);
writeFileSync(changelogPath, changelog);
git("add", "package.json", "CHANGELOG.md");
git("commit", "-m", `Release ${tag}`);
git("tag", "-a", tag, "-m", tag);

console.log(`release: ${pkg.version} -> ${version}, committed and tagged ${tag}`);
console.log("release: push when ready:");
console.log(`  git push origin main ${tag}`);
