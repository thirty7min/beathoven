"use client";

import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { isUsernameTaken, useAuth, type Profile } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { friendlyError } from "@/lib/game/error-messages";
import { removeAvatar, uploadAvatar } from "@/lib/profile/avatar";
import { normalizeDaws } from "@/lib/profile/daw-selection";
import type { DawSlug } from "@/lib/profile/daws";
import { saveProfileLink } from "@/lib/profile/link";
import { BIO_MAX, suggestUsername, validateProfile, type ProfileErrors } from "@/lib/profile/validate";
import { getBrowserClient } from "@/lib/supabase/client";
import { notifyError, notifyFailure } from "@/lib/ui/notify";
import { normalizeLinkInput } from "@/lib/ui/profile-link";
import { linkChange, saveProfileChanges, type AvatarChange } from "@/lib/ui/profile-save";
import { AvatarUploader } from "./avatar-uploader";
import { DawPicker } from "./daw-picker";

export function ProfileEditor({
  profile,
  open,
  onClose,
  onSaved,
}: {
  profile: Profile;
  open: boolean;
  onClose: () => void;
  onSaved: (profile: Profile) => void;
}) {
  const { setProfile } = useAuth();
  const [username, setUsername] = useState(profile.username);
  const [bio, setBio] = useState(profile.bio);
  const [link, setLink] = useState(profile.link_url ?? "");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [daws, setDaws] = useState<DawSlug[]>(() => normalizeDaws(profile.daws));
  const [avatar, setAvatar] = useState<AvatarChange>({ kind: "keep" });
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [saving, setSaving] = useState<"avatar" | "link" | "profile" | null>(null);
  const [progress, setProgress] = useState(0);
  const previewUrl = avatar.kind === "replace" ? avatar.previewUrl : null;

  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const draft = { username: username.trim(), avatarUrl: "", bio };
    const found = validateProfile(draft);
    setErrors(found);
    setAvatarError(null);
    setLinkError(null);
    if (Object.keys(found).length) return;

    const linkUpdate = linkChange(normalizeLinkInput(link), profile.link_url);
    setSaving(avatar.kind !== "keep" ? "avatar" : linkUpdate.changed ? "link" : "profile");
    setProgress(0);
    try {
      if (draft.username.toLowerCase() !== profile.username.toLowerCase() && (await isUsernameTaken(draft.username, profile.id))) {
        setErrors({ username: "That username is already taken." });
        return;
      }
      const result = await saveProfileChanges({ avatar, link: linkUpdate }, {
        uploadAvatar: (blob) => uploadAvatar(blob, { onProgress: setProgress }),
        removeAvatar,
        saveLink: (url) => {
          setSaving("link");
          return saveProfileLink(url);
        },
        saveProfile: async () => {
          setSaving("profile");
          const { data, error } = await getBrowserClient()
            .from("profiles")
            .update({ username: draft.username, bio: draft.bio, daws })
            .eq("id", profile.id)
            .select("*")
            .single();
          if (error) throw error;
          return data;
        },
      });
      if (!result.ok) {
        if (result.stage === "avatar") {
          const message = friendlyError(result.error, "Couldn't upload your avatar. Please try again.");
          setAvatarError(message);
          notifyFailure(message);
        } else if (result.stage === "link") {
          setLinkError(friendlyError(result.error, "Couldn't save that link. Please try again."));
        } else {
          const code = (result.error as { code?: string }).code;
          if (code === "23505") setErrors({ username: "That username is already taken." });
          else if (code === "23514") notifyFailure("Pick up to 3 DAWs from the list.");
          else notifyError(result.error, "Couldn't save your profile.");
        }
        return;
      }
      setProfile(result.profile);
      onSaved(result.profile);
      toast.success("Profile saved");
    } finally {
      setSaving(null);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Edit profile" className="max-h-[92dvh] max-w-lg overflow-y-auto">
      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <AvatarUploader
            name={username || profile.username}
            seed={profile.id}
            currentUrl={profile.avatar_url}
            change={avatar}
            onChange={(next) => {
              setAvatar(next);
              setAvatarError(null);
            }}
            disabled={saving !== null}
          />
          {avatarError && (
            <p role="alert" className="animate-drop-in text-sm text-danger">
              {avatarError}
            </p>
          )}
        </div>
        <Field label="Username" error={errors.username} hint="3 to 24 letters, numbers or underscores.">
          <Input value={username} maxLength={24} onChange={(e) => setUsername(suggestUsername(e.target.value))} autoComplete="username" />
        </Field>
        <Field label="Bio" error={errors.bio} hint={`${bio.length}/${BIO_MAX}`}>
          <Textarea value={bio} rows={4} maxLength={BIO_MAX} onChange={(e) => setBio(e.target.value)} placeholder="Genres, influences, what you're working on…" />
        </Field>
        <Field label="Link" error={linkError ?? undefined} hint="Checked for safety before it goes live. Shortened links aren't allowed.">
          <Input
            value={link}
            onChange={(e) => {
              setLink(e.target.value);
              setLinkError(null);
            }}
            placeholder="yoursite.com or soundcloud.com/you"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            aria-invalid={linkError !== null}
            disabled={saving !== null}
          />
        </Field>
        <DawPicker value={daws} onChange={setDaws} disabled={saving !== null} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving !== null}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving !== null}>
            {saving === "avatar" ? `Uploading ${Math.round(progress * 100)}%` : saving === "link" ? "Checking link…" : saving === "profile" ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
