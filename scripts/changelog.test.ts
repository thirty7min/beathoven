import { describe, expect, it } from "vitest";
import { bumpVersion, changelogSection, releaseChangelog } from "./changelog.mjs";

const REPO = "https://github.com/thirty7min/beathoven";

const changelog = `# Changelog

Intro.

## [Unreleased]

### Added
- Rematch button

### Fixed
- Dial sticking

## [0.1.0] - 2026-10-18

### Added
- First release

[Unreleased]: ${REPO}/compare/v0.1.0...HEAD
[0.1.0]: ${REPO}/releases/tag/v0.1.0
`;

describe("bumpVersion", () => {
  it("bumps each part and resets the lower ones", () => {
    expect(bumpVersion("1.4.7", "patch")).toBe("1.4.8");
    expect(bumpVersion("1.4.7", "minor")).toBe("1.5.0");
    expect(bumpVersion("1.4.7", "major")).toBe("2.0.0");
    expect(bumpVersion("0.9.9", "minor")).toBe("0.10.0");
  });

  it("rejects unknown bumps and non-plain versions", () => {
    expect(() => bumpVersion("1.4.7", "huge")).toThrow(/patch, minor, major/);
    expect(() => bumpVersion("1.4.7", undefined as unknown as string)).toThrow();
    expect(() => bumpVersion("1.4.7-beta.1", "patch")).toThrow(/X\.Y\.Z/);
    expect(() => bumpVersion("v1.4.7", "patch")).toThrow(/X\.Y\.Z/);
  });
});

describe("releaseChangelog", () => {
  const released = releaseChangelog(changelog, "0.2.0", "2026-11-01");

  it("moves the Unreleased notes into a dated section and leaves Unreleased empty", () => {
    expect(released).toContain(
      "## [Unreleased]\n\n## [0.2.0] - 2026-11-01\n\n### Added\n- Rematch button\n\n### Fixed\n- Dial sticking\n\n## [0.1.0] - 2026-10-18",
    );
    expect(released.startsWith("# Changelog\n\nIntro.\n\n## [Unreleased]")).toBe(true);
  });

  it("updates the compare links", () => {
    expect(released).toContain(
      `[Unreleased]: ${REPO}/compare/v0.2.0...HEAD\n[0.2.0]: ${REPO}/compare/v0.1.0...v0.2.0\n[0.1.0]: ${REPO}/releases/tag/v0.1.0\n`,
    );
  });

  it("produces notes the release workflow can extract", () => {
    expect(changelogSection(released, "0.2.0")).toBe("### Added\n- Rematch button\n\n### Fixed\n- Dial sticking");
    expect(changelogSection(released, "0.1.0")).toBe("### Added\n- First release");
  });

  it("refuses an empty Unreleased section", () => {
    expect(() => releaseChangelog(released, "0.3.0", "2026-11-02")).toThrow(/Unreleased section .* is empty/);
  });

  it("refuses a version that is already in the changelog", () => {
    expect(() => releaseChangelog(changelog, "0.1.0", "2026-11-02")).toThrow(/already has a section/);
  });

  it("refuses a changelog without an Unreleased section", () => {
    expect(() => releaseChangelog("# Changelog\n", "0.2.0", "2026-11-01")).toThrow(/no "## \[Unreleased\]"/);
  });

  it("works without link definitions", () => {
    const plain = "# Changelog\n\n## [Unreleased]\n\n- Thing\n";
    expect(releaseChangelog(plain, "1.0.0", "2026-11-01")).toBe("# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-11-01\n\n- Thing\n");
  });
});

describe("changelogSection", () => {
  it("fails for a missing version", () => {
    expect(() => changelogSection(changelog, "9.9.9")).toThrow(/no section for 9\.9\.9/);
  });
});
