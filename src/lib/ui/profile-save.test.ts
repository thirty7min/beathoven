import { describe, expect, it, vi } from "vitest";
import { linkChange, previewAvatarUrl, removalFor, saveProfileChanges, type AvatarChange, type ProfileSaveSteps } from "./profile-save";

const blob = new Blob(["x"], { type: "image/webp" });
const replace: AvatarChange = { kind: "replace", blob, previewUrl: "blob:preview" };
const keep: AvatarChange = { kind: "keep" };

function steps(overrides: Partial<ProfileSaveSteps<{ id: string }>> = {}) {
  return {
    uploadAvatar: vi.fn(async () => ({ avatarUrl: "https://x/a.webp" })),
    removeAvatar: vi.fn(async () => undefined),
    saveLink: vi.fn(async () => ({ linkUrl: null })),
    saveProfile: vi.fn(async () => ({ id: "p" })),
    ...overrides,
  };
}

describe("saveProfileChanges", () => {
  it("runs avatar, then link, then profile", async () => {
    const order: string[] = [];
    const s = steps({
      uploadAvatar: vi.fn(async () => order.push("avatar")),
      saveLink: vi.fn(async () => order.push("link")),
      saveProfile: vi.fn(async () => {
        order.push("profile");
        return { id: "p" };
      }),
    });
    const result = await saveProfileChanges({ avatar: replace, link: { changed: true, url: "https://a.com" } }, s);
    expect(result).toEqual({ ok: true, profile: { id: "p" } });
    expect(order).toEqual(["avatar", "link", "profile"]);
    expect(s.uploadAvatar).toHaveBeenCalledWith(blob);
    expect(s.saveLink).toHaveBeenCalledWith("https://a.com");
  });

  it("clears the link with null and skips unchanged links and avatars", async () => {
    const clearing = steps();
    await saveProfileChanges({ avatar: keep, link: { changed: true, url: null } }, clearing);
    expect(clearing.saveLink).toHaveBeenCalledWith(null);

    const untouched = steps();
    await saveProfileChanges({ avatar: keep, link: { changed: false } }, untouched);
    expect(untouched.saveLink).not.toHaveBeenCalled();
    expect(untouched.uploadAvatar).not.toHaveBeenCalled();
    expect(untouched.removeAvatar).not.toHaveBeenCalled();
    expect(untouched.saveProfile).toHaveBeenCalledOnce();
  });

  it("removes the avatar when asked", async () => {
    const s = steps();
    await saveProfileChanges({ avatar: { kind: "remove" }, link: { changed: false } }, s);
    expect(s.removeAvatar).toHaveBeenCalledOnce();
  });

  it("stops at the first failing step", async () => {
    const avatarFails = steps({ uploadAvatar: vi.fn(async () => Promise.reject(new Error("unsupported_image"))) });
    expect(await saveProfileChanges({ avatar: replace, link: { changed: true, url: "https://a.com" } }, avatarFails)).toMatchObject({
      ok: false,
      stage: "avatar",
    });
    expect(avatarFails.saveLink).not.toHaveBeenCalled();
    expect(avatarFails.saveProfile).not.toHaveBeenCalled();

    const linkFails = steps({ saveLink: vi.fn(async () => Promise.reject(new Error("unsafe_link"))) });
    expect(await saveProfileChanges({ avatar: keep, link: { changed: true, url: "https://bad.example" } }, linkFails)).toMatchObject({
      ok: false,
      stage: "link",
    });
    expect(linkFails.saveProfile).not.toHaveBeenCalled();

    const profileFails = steps({ saveProfile: vi.fn(async () => Promise.reject(new Error("23505"))) });
    expect(await saveProfileChanges({ avatar: keep, link: { changed: false } }, profileFails)).toMatchObject({ ok: false, stage: "profile" });
  });
});

describe("linkChange", () => {
  it("only saves when the normalised link differs", () => {
    expect(linkChange("https://a.com", "https://a.com")).toEqual({ changed: false });
    expect(linkChange(null, "https://a.com")).toEqual({ changed: true, url: null });
    expect(linkChange("https://b.com", null)).toEqual({ changed: true, url: "https://b.com" });
  });
});

describe("pending avatar preview", () => {
  it("shows the pending crop, nothing after a removal, else the saved avatar", () => {
    expect(previewAvatarUrl(replace, "https://x/old.webp")).toBe("blob:preview");
    expect(previewAvatarUrl({ kind: "remove" }, "https://x/old.webp")).toBeNull();
    expect(previewAvatarUrl(keep, "https://x/old.webp")).toBe("https://x/old.webp");
  });

  it("removing a pending crop with no saved avatar just discards it", () => {
    expect(removalFor(null)).toEqual({ kind: "keep" });
    expect(removalFor("https://x/old.webp")).toEqual({ kind: "remove" });
  });
});
