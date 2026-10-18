"use client";

import { ChevronDown, LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AuthPanel } from "./auth-panel";
import { useAuth } from "./auth-provider";
import { Avatar } from "./ui/avatar";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { notifyFailure } from "@/lib/ui/notify";
import { displayName } from "@/lib/ui/display-name";

export function UserMenu() {
  const { status, profile, user, isGuest, signOut } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        setOpen(false);
        setConfirming(false);
      }
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (status === "loading") return <div className="h-9 w-9 animate-pulse rounded-full bg-raised" />;

  if (status === "signed_out") {
    return (
      <>
        <Button size="sm" variant="outline" onClick={() => setSignInOpen(true)}>
          Sign in
        </Button>
        <Dialog open={signInOpen} onClose={() => setSignInOpen(false)} title="Jump in">
          <AuthPanel onDone={() => setSignInOpen(false)} />
        </Dialog>
      </>
    );
  }

  const name = profile ? displayName(profile) : "…";

  async function onSignOut() {
    if (isGuest && !confirming) {
      setConfirming(true);
      return;
    }
    try {
      await signOut();
      setOpen(false);
      setConfirming(false);
      router.push("/");
    } catch {
      notifyFailure("Couldn't sign out. Please try again.");
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Account menu"
        className="flex items-center gap-1.5 rounded-full transition hover:opacity-90"
      >
        <Avatar name={name} url={profile?.avatar_url} seed={user?.id} size="sm" />
        <ChevronDown className="h-4 w-4 text-muted" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-64 animate-fade-in overflow-hidden rounded-xl border border-line bg-raised p-1.5 shadow-2xl"
        >
          <div className="flex items-center gap-3 px-3 py-2.5">
            <Avatar name={name} url={profile?.avatar_url} seed={user?.id} size="md" />
            <div className="min-w-0">
              <p className="truncate font-semibold">{name}</p>
              {isGuest ? <Badge>Guest</Badge> : <p className="truncate text-xs text-muted">{user?.email}</p>}
            </div>
          </div>
          <div className="my-1 h-px bg-line" />
          {profile && (
            <Link
              role="menuitem"
              href={`/u/${profile.username}`}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-fg hover:bg-white/[0.06]"
            >
              <UserRound className="h-4 w-4 text-muted" />
              Your profile
            </Link>
          )}
          {confirming && (
            <p className="px-3 pt-2 text-xs text-muted">
              Guest accounts can&apos;t be recovered after signing out. Your stats will be lost.
            </p>
          )}
          <button
            role="menuitem"
            onClick={onSignOut}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-fg hover:bg-white/[0.06]"
          >
            <LogOut className="h-4 w-4 text-muted" />
            {confirming ? <span className="text-danger">Sign out anyway</span> : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}
