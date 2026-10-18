"use client";

import { Radio, Trophy, UserRound } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { AuthPanel } from "@/components/auth-panel";
import { useAuth } from "@/components/auth-provider";
import { Dialog } from "@/components/ui/dialog";

const tileClasses =
  "flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-lg border border-line bg-surface text-muted transition hover:border-line-strong hover:bg-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-fg";

export function HomeScreen() {
  const { profile, status } = useAuth();
  const [signInOpen, setSignInOpen] = useState(false);

  return (
    <div className="flex w-full max-w-xl flex-col items-center gap-10">
      <h1 className="text-center text-6xl leading-none font-black tracking-tighter sm:text-8xl">Beathoven</h1>

      <div className="flex w-full flex-col gap-3">
        <Link
          href="/play"
          className="group flex flex-col items-center justify-center gap-1 rounded-lg bg-fg px-6 py-5 text-page transition hover:bg-white/85 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-fg"
        >
          <span className="text-4xl font-black tracking-tight uppercase sm:text-5xl">Play</span>
          <span className="text-[13px] font-semibold tracking-[0.12em] text-page/60 uppercase">Host a battle · Join with a code</span>
        </Link>

        <div className="grid grid-cols-3 gap-3">
          <Tile href="/lobbies" icon={<Radio />} label="Lobbies" />
          <Tile href="/leaderboard" icon={<Trophy />} label="Leaderboard" />
          {profile ? (
            <Tile href={`/u/${profile.username}`} icon={<UserRound />} label="Profile" />
          ) : (
            <button className={tileClasses} onClick={() => setSignInOpen(true)} disabled={status === "loading"}>
              <TileContent icon={<UserRound />} label="Profile" />
            </button>
          )}
        </div>
      </div>

      <Dialog open={signInOpen} onClose={() => setSignInOpen(false)} title="Sign in to see your profile">
        <AuthPanel onDone={() => setSignInOpen(false)} />
      </Dialog>
    </div>
  );
}

function Tile({ href, icon, label }: { href: string; icon: ReactNode; label: string }) {
  return (
    <Link href={href} className={tileClasses}>
      <TileContent icon={icon} label={label} />
    </Link>
  );
}

function TileContent({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <>
      <span className="[&>svg]:h-6 [&>svg]:w-6 [&>svg]:stroke-[1.5]">{icon}</span>
      <span className="text-xs font-semibold tracking-[0.1em] uppercase">{label}</span>
    </>
  );
}
