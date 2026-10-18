const BUMPS = ["patch", "minor", "major"];
const UNRELEASED_HEADING = "## [Unreleased]";
const UNRELEASED_LINK = /^\[Unreleased\]: (\S+)\/compare\/(\S+)\.\.\.HEAD$/m;

export function bumpVersion(version, bump) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`"${version}" is not a plain X.Y.Z version`);
  if (!BUMPS.includes(bump)) throw new Error(`bump must be one of ${BUMPS.join(", ")}`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function isSectionEnd(line) {
  return line.startsWith("## ") || /^\[[^\]]+\]: /.test(line);
}

function sectionBounds(lines, heading) {
  const start = lines.findIndex((line) => line === heading || line.startsWith(`${heading} `));
  if (start === -1) return null;
  const rest = lines.slice(start + 1).findIndex(isSectionEnd);
  return { start, end: rest === -1 ? lines.length : start + 1 + rest };
}

export function changelogSection(changelog, version) {
  const lines = changelog.split("\n");
  const bounds = sectionBounds(lines, `## [${version}]`);
  if (!bounds) throw new Error(`CHANGELOG.md has no section for ${version}`);
  const notes = lines.slice(bounds.start + 1, bounds.end).join("\n").trim();
  if (!notes) throw new Error(`CHANGELOG.md section for ${version} is empty`);
  return notes;
}

export function releaseChangelog(changelog, version, date) {
  const lines = changelog.split("\n");
  const bounds = sectionBounds(lines, UNRELEASED_HEADING);
  if (!bounds) throw new Error(`CHANGELOG.md has no "${UNRELEASED_HEADING}" section`);
  if (sectionBounds(lines, `## [${version}]`)) throw new Error(`CHANGELOG.md already has a section for ${version}`);
  const notes = lines.slice(bounds.start + 1, bounds.end).join("\n").trim();
  if (!notes) throw new Error("the Unreleased section of CHANGELOG.md is empty");

  const released = [
    ...lines.slice(0, bounds.start),
    UNRELEASED_HEADING,
    "",
    `## [${version}] - ${date}`,
    "",
    notes,
    "",
    ...lines.slice(bounds.end),
  ].join("\n");

  return released.replace(
    UNRELEASED_LINK,
    (_, base, previous) => `[Unreleased]: ${base}/compare/v${version}...HEAD\n[${version}]: ${base}/compare/${previous}...v${version}`,
  );
}
