"use client";

import { ArrowUpRight, Crown } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Profile } from "@/components/auth-provider";
import { DawList } from "@/components/profile/daw-badge";
import { ProfileLink } from "@/components/profile/profile-link";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useIsOnline } from "@/components/presence-provider";
import { Skeleton, SkeletonGroup, SkeletonText } from "@/components/ui/skeleton";
import { StatStrip } from "@/components/ui/stat-strip";
import type { RoomPlayer } from "@/lib/game/types";
import { getBrowserClient } from "@/lib/supabase/client";
import { displayName } from "@/lib/ui/display-name";

const STAT_LABELS = ["Wins", "Ties", "Battles"];
const FRESH_MS = 30_000;

type CachedProfile = { at: number; promise: Promise<Profile | null>; data?: Profile | null };

const profiles = new Map<string, CachedProfile>();

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await getBrowserClient().from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

export function prefetchProfile(userId: string): Promise<Profile | null> {
  const previous = profiles.get(userId);
  if (previous && Date.now() - previous.at < FRESH_MS) return previous.promise;
  const entry: CachedProfile = { at: Date.now(), promise: fetchProfile(userId), data: previous?.data };
  entry.promise.then(
    (data) => {
      entry.data = data;
    },
    () => {
      entry.at = 0;
    },
  );
  profiles.set(userId, entry);
  return entry.promise;
}

export function ProfileCard({
  player,
  isHost,
  onClose,
}: {
  player: RoomPlayer | null;
  isHost: boolean;
  onClose: () => void;
}) {
  const [profile, setProfile] = useState<{ id: string; data: Profile | null } | null>(null);
  const userId = player?.user_id ?? null;
  const online = useIsOnline(userId) || player?.is_bot === true;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    prefetchProfile(userId).then(
      (data) => !cancelled && setProfile({ id: userId, data }),
      () => !cancelled && setProfile({ id: userId, data: profiles.get(userId)?.data ?? null }),
    );
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const fetched = profile?.id === userId ? profile.data : userId ? profiles.get(userId)?.data : undefined;
  const loading = fetched === undefined;
  const loaded = fetched ?? null;
  const username = loaded?.username ?? player?.username ?? "";
  const name = displayName(loaded ?? player, username);

  return (
    <Dialog open={player !== null} onClose={onClose} title="Producer" className="max-w-sm">
      {player && (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-4">
            <Avatar name={name} url={loaded?.avatar_url ?? player.avatar_url} seed={player.user_id} size="xl" />
            <div className="min-w-0">
              <p className="truncate text-xl font-bold">{name}</p>
              <p className="truncate text-sm text-muted">@{username}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {isHost && (
                  <Badge tone="solid">
                    <Crown className="h-3 w-3" />
                    Host
                  </Badge>
                )}
                <Badge>
                  <span className={online ? "h-1.5 w-1.5 rounded-full bg-online" : "h-1.5 w-1.5 rounded-full bg-subtle"} />
                  {online ? "Online" : "Offline"}
                </Badge>
              </div>
            </div>
          </div>
          {loading ? (
            <SkeletonGroup label="Loading profile" className="flex flex-col gap-5">
              <span className="flex flex-col text-sm">
                <SkeletonText className="w-full" />
                <SkeletonText className="w-2/3" />
              </span>
              <span className="flex items-center gap-1.5">
                <Skeleton className="h-7 w-24 rounded-full" />
                <Skeleton className="h-7 w-20 rounded-full" />
              </span>
              <SkeletonText className="w-36 text-sm" />
              <StatStrip className="rounded-xl border border-line p-4" stats={STAT_LABELS.map((label) => ({ label, value: <SkeletonText className="w-6" /> }))} />
            </SkeletonGroup>
          ) : (
            <>
              {loaded?.bio && <p className="text-sm whitespace-pre-line text-muted">{loaded.bio}</p>}
              {loaded && <DawList daws={loaded.daws} />}
              {loaded && <ProfileLink username={loaded.username} linkUrl={loaded.link_url} className="self-start" />}
              <StatStrip
                className="rounded-xl border border-line p-4"
                stats={[
                  { label: "Wins", value: loaded?.wins ?? 0 },
                  { label: "Ties", value: loaded?.ties ?? 0 },
                  { label: "Battles", value: loaded?.games_played ?? 0 },
                ]}
              />
            </>
          )}
          <Link href={`/u/${username}`} className={buttonClasses("outline", "md")} target="_blank">
            View full profile
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      )}
    </Dialog>
  );
}
