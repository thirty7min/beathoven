"use client";

import { Check, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useAuth, type Profile } from "@/components/auth-provider";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { friendlyError } from "@/lib/game/error-messages";
import { GameError } from "@/lib/game/errors";
import { uploadAvatar } from "@/lib/profile/avatar";
import type { DawSlug } from "@/lib/profile/daws";
import { completeOnboarding, isUsernameAvailable, needsOnboarding } from "@/lib/profile/onboarding";
import { BIO_MAX, DISPLAY_NAME_MAX, suggestUsername, validateDisplayName } from "@/lib/profile/validate";
import { getBrowserClient } from "@/lib/supabase/client";
import { notifyError } from "@/lib/ui/notify";
import { canFinishOnboarding, initialOnboarding, usernameStatus, type UsernameCheck, type UsernameStatus } from "@/lib/ui/onboarding";
import type { AvatarChange } from "@/lib/ui/profile-save";
import { AvatarUploader } from "./avatar-uploader";
import { DawPicker } from "./daw-picker";

const CHECK_DEBOUNCE_MS = 300;

export function OnboardingGate() {
  const { user, profile } = useAuth();
  if (!user || !profile || !needsOnboarding(profile, user)) return null;
  return <OnboardingDialog key={profile.id} profile={profile} metadata={user.user_metadata} email={user.email} />;
}

function OnboardingDialog({ profile, metadata, email }: { profile: Profile; metadata: Record<string, unknown>; email: string | undefined }) {
  const { refreshProfile, signOut } = useAuth();
  const [initial] = useState(() => initialOnboarding({ metadata, email, currentUsername: profile.username }));
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [username, setUsername] = useState(initial.username);
  const [bio, setBio] = useState("");
  const [daws, setDaws] = useState<DawSlug[]>([]);
  const [avatar, setAvatar] = useState<AvatarChange>({ kind: "keep" });
  const [check, setCheck] = useState<UsernameCheck | null>(null);
  const [touchedName, setTouchedName] = useState(false);
  const [saving, setSaving] = useState<"avatar" | "profile" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const previewUrl = avatar.kind === "replace" ? avatar.previewUrl : null;

  const nameError = validateDisplayName(displayName);
  const status = usernameStatus(username, check);
  const ready = canFinishOnboarding(nameError, status);

  useEffect(() => {
    nameInput.current?.focus();
    nameInput.current?.select();
  }, []);

  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(() => {
    if (usernameStatus(username, null).kind === "invalid") return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      isUsernameAvailable(getBrowserClient(), username).then(
        (available) => !cancelled && setCheck({ username, available }),
        () => !cancelled && setCheck({ username, available: null }),
      );
    }, CHECK_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [username]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setTouchedName(true);
    if (!ready || saving) return;
    setError(null);
    let stage: "avatar" | "profile" = "profile";
    try {
      if (avatar.kind === "replace") {
        stage = "avatar";
        setSaving("avatar");
        await uploadAvatar(avatar.blob);
        setAvatar({ kind: "keep" });
      }
      stage = "profile";
      setSaving("profile");
      await completeOnboarding(getBrowserClient(), { displayName, username, bio, daws });
      await refreshProfile();
      toast.success(`Welcome, ${displayName.trim()}`);
    } catch (e) {
      if (e instanceof GameError && e.code === "username_taken") setCheck({ username, available: false });
      else if (e instanceof GameError && (e.code === "invalid_display_name" || e.code === "invalid_username")) setError(friendlyError(e));
      else if (stage === "avatar") setError(friendlyError(e, "Couldn't upload your avatar. Try again or skip it."));
      else notifyError(e, "Couldn't finish setting up your profile.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <Dialog open dismissible={false} onClose={() => {}} label="Welcome to Beathoven" className="max-h-[92dvh] max-w-lg overflow-y-auto">
      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-3">
          <Logo />
          <div>
            <h2 className="text-xl font-bold tracking-tight">
              Welcome to Beathoven
            </h2>
            <p className="text-sm text-muted">Pick how you show up in battles. You can change this later.</p>
          </div>
        </div>

        <AvatarUploader
          name={displayName || username}
          seed={profile.id}
          currentUrl={profile.avatar_url}
          change={avatar}
          onChange={(next) => {
            setAvatar(next);
            setError(null);
          }}
          disabled={saving !== null}
        />

        <Field label="Display name" error={touchedName ? nameError : null} hint="Shown to other players. Spaces and emoji are fine.">
          <Input
            ref={nameInput}
            value={displayName}
            maxLength={DISPLAY_NAME_MAX * 2}
            onChange={(e) => setDisplayName(e.target.value)}
            onBlur={() => setTouchedName(true)}
            autoComplete="nickname"
            aria-invalid={touchedName && nameError !== null}
            disabled={saving !== null}
          />
        </Field>

        <Field label="Username" error={status.kind === "invalid" || status.kind === "taken" ? usernameMessage(status, username) : null} hint={usernameMessage(status, username)}>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-sm text-subtle">@</span>
            <Input
              value={username}
              maxLength={24}
              onChange={(e) => setUsername(suggestUsername(e.target.value))}
              autoComplete="username"
              spellCheck={false}
              aria-invalid={status.kind === "invalid" || status.kind === "taken"}
              className="pr-10 pl-8"
              disabled={saving !== null}
            />
            <UsernameIndicator status={status} />
          </div>
        </Field>

        <Field label="Bio (optional)" hint={`${bio.length}/${BIO_MAX}`}>
          <Textarea
            value={bio}
            rows={3}
            maxLength={BIO_MAX}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Genres, influences, what you're working on…"
            disabled={saving !== null}
          />
        </Field>

        <DawPicker value={daws} onChange={setDaws} label="DAWs (optional)" disabled={saving !== null} />

        {error && (
          <p role="alert" className="animate-drop-in text-sm text-danger">
            {error}
          </p>
        )}

        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" onClick={() => void signOut()} disabled={saving !== null}>
            Sign out
          </Button>
          <Button type="submit" variant="primary" size="lg" disabled={!ready} loading={saving !== null}>
            {saving === "avatar" ? "Uploading…" : saving === "profile" ? "Saving…" : "Continue"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function usernameMessage(status: UsernameStatus, username: string): string {
  switch (status.kind) {
    case "invalid":
      return status.message;
    case "checking":
      return "Checking…";
    case "available":
      return `@${username} is available.`;
    case "taken":
      return "That username is already taken.";
    case "unknown":
      return "Couldn't check right now. We'll confirm when you continue.";
  }
}

function UsernameIndicator({ status }: { status: UsernameStatus }) {
  return (
    <span className="pointer-events-none absolute top-1/2 right-3.5 flex h-4 w-4 -translate-y-1/2 items-center justify-center" aria-hidden>
      <span key={status.kind} className={cn("flex animate-swap", status.kind === "available" ? "text-fg" : "text-muted")}>
        {status.kind === "checking" ? (
          <Spinner className="h-3.5 w-3.5" />
        ) : status.kind === "available" ? (
          <Check className="h-4 w-4" />
        ) : status.kind === "taken" || status.kind === "invalid" ? (
          <X className="h-4 w-4 text-danger" />
        ) : null}
      </span>
    </span>
  );
}
