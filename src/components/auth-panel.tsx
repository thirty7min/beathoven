"use client";

import { ArrowRight } from "lucide-react";
import { useState, type FormEvent } from "react";
import { suggestUsername } from "@/lib/profile/validate";
import { AuthError, useAuth, type OAuthProvider } from "./auth-provider";
import { Button } from "./ui/button";
import { LegalNotice } from "./legal/legal-notice";
import { DiscordIcon, GoogleIcon } from "./ui/brand-icons";
import { Input } from "./ui/field";
import { notifyFailure } from "@/lib/ui/notify";

const DISCORD_ENABLED = false;

export function AuthPanel({ next, onDone }: { next?: string; onDone?: () => void }) {
  const { signInAsGuest, signInWithProvider } = useAuth();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"guest" | OAuthProvider | null>(null);

  async function onGuest(event: FormEvent) {
    event.preventDefault();
    setBusy("guest");
    setError(null);
    try {
      await signInAsGuest(name);
      onDone?.();
    } catch (e) {
      setError(e instanceof AuthError ? e.message : "Couldn't sign you in. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function onProvider(provider: OAuthProvider) {
    setBusy(provider);
    try {
      await signInWithProvider(provider, next);
    } catch (e) {
      notifyFailure("Sign-in failed", e instanceof Error ? e.message : undefined);
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={onGuest} className="flex flex-col gap-2">
        <label htmlFor="guest-name" className="text-sm font-medium text-fg">
          Play as a guest
        </label>
        <div className="flex gap-2">
          <Input
            id="guest-name"
            className="rounded-full px-4"
            autoComplete="nickname"
            placeholder="Pick a producer name"
            value={name}
            maxLength={24}
            onChange={(e) => {
              setName(suggestUsername(e.target.value));
              setError(null);
            }}
          />
          <Button type="submit" variant="primary" loading={busy === "guest"} disabled={busy !== null || name.length < 3}>
            Play
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
        <p className={error ? "text-xs text-danger" : "text-xs text-muted"}>
          {error ?? "3 to 24 letters, numbers or underscores."}
        </p>
      </form>

      <div className="flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-line" />
        or keep your stats across devices
        <span className="h-px flex-1 bg-line" />
      </div>

      <div className={DISCORD_ENABLED ? "grid gap-2 sm:grid-cols-2" : "grid gap-2"}>
        {DISCORD_ENABLED && (
          <Button onClick={() => onProvider("discord")} loading={busy === "discord"} disabled={busy !== null} variant="outline">
            <DiscordIcon className="h-4 w-4" />
            Continue with Discord
          </Button>
        )}
        <Button
          onClick={() => onProvider("google")}
          loading={busy === "google"}
          disabled={busy !== null}
          variant="outline"
        >
          <GoogleIcon className="h-4 w-4" />
          Continue with Google
        </Button>
      </div>

      <LegalNotice className="text-center" />
    </div>
  );
}
