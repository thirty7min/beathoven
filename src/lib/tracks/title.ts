export const MAX_TRACK_TITLE = 80;

const INVISIBLE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g;

export function cleanTrackTitle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.normalize("NFKC").replace(INVISIBLE, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return Array.from(cleaned).slice(0, MAX_TRACK_TITLE).join("").trim();
}

export function titleFromFileName(fileName: string | null | undefined): string | null {
  if (!fileName) return null;
  const base = fileName.split(/[\\/]/).pop() ?? "";
  return cleanTrackTitle(base.replace(/\.[A-Za-z0-9]{1,5}$/, "").replace(/_+/g, " "));
}

export function defaultTrackTitle(tagTitle: string | null | undefined, fileName: string | null | undefined) {
  return cleanTrackTitle(tagTitle) ?? titleFromFileName(fileName);
}
