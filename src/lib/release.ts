export const REPO_URL = "https://github.com/thirty7min/beathoven";

export function releaseUrl(version: string): string {
  return `${REPO_URL}/releases/tag/v${version}`;
}
