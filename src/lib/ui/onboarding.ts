import { DISPLAY_NAME_MAX, normalizeDisplayName, suggestUsername, validateUsername } from "@/lib/profile/validate";

type Metadata = Record<string, unknown> | null | undefined;

const NAME_KEYS = ["full_name", "name", "global_name", "user_name", "preferred_username"] as const;

function firstString(metadata: Metadata, keys: readonly string[]): string {
  for (const key of keys) {
    const value = metadata?.[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

export function initialOnboarding({
  metadata,
  email,
  currentUsername,
}: {
  metadata: Metadata;
  email: string | null | undefined;
  currentUsername: string;
}): { displayName: string; username: string } {
  const name = normalizeDisplayName(firstString(metadata, NAME_KEYS));
  const displayName = Array.from(name).slice(0, DISPLAY_NAME_MAX).join("").trim();
  const candidates = [firstString(metadata, ["user_name", "preferred_username"]), name, email?.split("@")[0] ?? ""];
  const username = candidates.map(suggestUsername).find((candidate) => validateUsername(candidate) === null) ?? currentUsername;
  return { displayName, username };
}

export type UsernameCheck = { username: string; available: boolean | null };

export type UsernameStatus =
  | { kind: "invalid"; message: string }
  | { kind: "checking" }
  | { kind: "available" }
  | { kind: "taken" }
  | { kind: "unknown" };

export function usernameStatus(username: string, check: UsernameCheck | null): UsernameStatus {
  const invalid = validateUsername(username);
  if (invalid) return { kind: "invalid", message: invalid };
  if (!check || check.username !== username) return { kind: "checking" };
  if (check.available === null) return { kind: "unknown" };
  return check.available ? { kind: "available" } : { kind: "taken" };
}

export function canFinishOnboarding(displayNameError: string | null, status: UsernameStatus): boolean {
  return displayNameError === null && (status.kind === "available" || status.kind === "unknown");
}
