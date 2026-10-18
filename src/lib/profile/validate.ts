export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,24}$/;
export const BIO_MAX = 500;
export const AVATAR_URL_MAX = 500;
export const DISPLAY_NAME_MAX = 32;

const DISPLAY_NAME_FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u200b\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/;

export function normalizeDisplayName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

export function validateDisplayName(name: string): string | null {
  const normalized = normalizeDisplayName(name);
  if (normalized.length === 0) return "Add a display name.";
  if (Array.from(normalized).length > DISPLAY_NAME_MAX) return `Display names can be at most ${DISPLAY_NAME_MAX} characters.`;
  if (DISPLAY_NAME_FORBIDDEN.test(normalized)) return "Display names can't contain hidden or control characters.";
  return null;
}

export function suggestUsername(input: string): string {
  return input.trim().replace(/\s+/g, "_").replace(/[^A-Za-z0-9_]/g, "").slice(0, 24);
}

export function validateUsername(username: string): string | null {
  if (username.length < 3) return "Usernames need at least 3 characters.";
  if (username.length > 24) return "Usernames can be at most 24 characters.";
  if (!USERNAME_PATTERN.test(username)) return "Use only letters, numbers and underscores.";
  return null;
}

export function validateAvatarUrl(url: string): string | null {
  if (url === "") return null;
  if (url.length > AVATAR_URL_MAX) return "That URL is too long.";
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "Use an http(s) image URL.";
  } catch {
    return "That isn't a valid URL.";
  }
  return null;
}

export function validateBio(bio: string): string | null {
  return bio.length > BIO_MAX ? `Bios can be at most ${BIO_MAX} characters.` : null;
}

export type ProfileDraft = { username: string; avatarUrl: string; bio: string };
export type ProfileErrors = Partial<Record<keyof ProfileDraft, string>>;

export function validateProfile(draft: ProfileDraft): ProfileErrors {
  const errors: ProfileErrors = {};
  const username = validateUsername(draft.username.trim());
  const avatarUrl = validateAvatarUrl(draft.avatarUrl.trim());
  const bio = validateBio(draft.bio);
  if (username) errors.username = username;
  if (avatarUrl) errors.avatarUrl = avatarUrl;
  if (bio) errors.bio = bio;
  return errors;
}

/** Escapes LIKE wildcards; usernames may contain `_`. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
