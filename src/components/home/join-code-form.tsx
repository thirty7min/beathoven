"use client";

import { ArrowRight, KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { useCurrentRoom } from "@/hooks/use-current-room";
import { friendlyError } from "@/lib/game/error-messages";
import { isRoomCode, normalizeRoomCode } from "@/lib/game/room-settings";
import { joinRoom } from "@/lib/game/rpc";
import { getBrowserClient } from "@/lib/supabase/client";

export function JoinCodeButton() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <Button variant="outline" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog">
        <KeyRound className="h-4 w-4" />
        Join with code
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label="Join with code"
          className="absolute top-full right-0 z-40 mt-2 w-[min(20rem,calc(100vw-2rem))] origin-top-right animate-menu rounded-xl border border-line-strong bg-surface p-3 shadow-2xl shadow-black/60"
        >
          <JoinCodeForm />
        </div>
      )}
    </div>
  );
}

function JoinCodeForm() {
  const router = useRouter();
  const { user } = useAuth();
  const { room: current } = useCurrentRoom(user?.id ?? null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!isRoomCode(code) || joining) return;
    if (!user || current) {
      router.push(`/room/${code}`);
      return;
    }
    setJoining(true);
    setError(null);
    try {
      await joinRoom(getBrowserClient(), code);
      router.push(`/room/${code}`);
    } catch (e) {
      setError(friendlyError(e, "Couldn't join that room. Please try again."));
      setJoining(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          aria-label="Room code"
          aria-invalid={error !== null}
          aria-describedby={error ? "join-code-error" : undefined}
          placeholder="ABC123"
          value={code}
          autoFocus
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setCode(normalizeRoomCode(e.target.value));
            setError(null);
          }}
          className="h-10 w-full min-w-0 rounded-full border border-line-strong bg-transparent px-4 font-mono tracking-[0.3em] uppercase placeholder:text-subtle focus:border-fg/60 focus:outline-none"
        />
        <Button type="submit" variant="primary" disabled={!isRoomCode(code)} loading={joining}>
          Join
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
      {error && (
        <p id="join-code-error" role="alert" className="animate-drop-in px-1 text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
