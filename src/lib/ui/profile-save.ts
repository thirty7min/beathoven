export type AvatarChange = { kind: "keep" } | { kind: "replace"; blob: Blob; previewUrl: string } | { kind: "remove" };
export type LinkChange = { changed: false } | { changed: true; url: string | null };

export type ProfileSaveSteps<P> = {
  uploadAvatar: (blob: Blob) => Promise<unknown>;
  removeAvatar: () => Promise<unknown>;
  saveLink: (url: string | null) => Promise<unknown>;
  saveProfile: () => Promise<P>;
};

export type ProfileSaveStage = "avatar" | "link" | "profile";
export type ProfileSaveResult<P> = { ok: true; profile: P } | { ok: false; stage: ProfileSaveStage; error: unknown };

export function linkChange(next: string | null, current: string | null): LinkChange {
  return next === current ? { changed: false } : { changed: true, url: next };
}

export async function saveProfileChanges<P>(
  changes: { avatar: AvatarChange; link: LinkChange },
  steps: ProfileSaveSteps<P>,
): Promise<ProfileSaveResult<P>> {
  const { avatar, link } = changes;
  try {
    if (avatar.kind === "replace") await steps.uploadAvatar(avatar.blob);
    else if (avatar.kind === "remove") await steps.removeAvatar();
  } catch (error) {
    return { ok: false, stage: "avatar", error };
  }
  try {
    if (link.changed) await steps.saveLink(link.url);
  } catch (error) {
    return { ok: false, stage: "link", error };
  }
  try {
    return { ok: true, profile: await steps.saveProfile() };
  } catch (error) {
    return { ok: false, stage: "profile", error };
  }
}

export function previewAvatarUrl(change: AvatarChange, currentUrl: string | null): string | null {
  if (change.kind === "replace") return change.previewUrl;
  return change.kind === "remove" ? null : currentUrl;
}

export function removalFor(currentUrl: string | null): AvatarChange {
  return currentUrl ? { kind: "remove" } : { kind: "keep" };
}
