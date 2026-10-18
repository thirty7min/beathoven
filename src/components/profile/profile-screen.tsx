"use client";

import { Pencil, Trophy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { EmptyState, LobbyListSkeleton } from "@/components/home/lobby-list";
import { ModeIcon } from "@/components/home/mode-icon";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ListRow, ListTable, Thumb } from "@/components/ui/list";
import { StatStrip } from "@/components/ui/stat-strip";
import { Tabs } from "@/components/ui/tabs";
import { useProfile, type RoundHistoryItem } from "@/hooks/use-profile";
import { formatScore } from "@/lib/game/format";
import { modeName } from "@/lib/game/room-settings";
import type { ListColumn } from "@/lib/ui/list-columns";
import { DawList } from "./daw-badge";
import { ProfileEditor } from "./profile-editor";
import { ProfileLink } from "./profile-link";

const COLUMNS: ListColumn[] = [
  { label: "Battle", width: "minmax(0,1fr)" },
  { label: "Place", width: "4rem", smWidth: "6rem", align: "end" },
  { label: "Avg", width: "3.5rem", smWidth: "5rem", align: "end" },
  { label: "Votes", width: "5rem", align: "end", fromSm: true },
  { label: "Date", width: "7rem", align: "end", fromSm: true },
];

export function ProfileScreen({ username }: { username: string }) {
  const { state, reload } = useProfile(username);
  const { user } = useAuth();
  const router = useRouter();
  const [editing, setEditing] = useState(false);

  if (state.status === "loading") {
    return <div className="h-72 animate-pulse rounded-2xl border border-line bg-surface" />;
  }
  if (state.status !== "ready") {
    return (
      <Card className="p-8">
        <h1 className="text-2xl font-bold">{state.status === "not_found" ? "Producer not found" : "Couldn't load this profile"}</h1>
        <p className="mt-1 text-sm text-muted">
          {state.status === "not_found" ? `Nobody goes by “${username}” right now.` : "Check your connection and try again."}
        </p>
      </Card>
    );
  }

  const { profile, history } = state;
  const isOwner = user?.id === profile.id;
  const winRate = profile.games_played ? Math.round((profile.wins / profile.games_played) * 100) : null;

  return (
    <div className="flex flex-col gap-10">
      <Card className="flex flex-col gap-8 p-6 sm:p-8">
        <div className="flex flex-wrap items-start gap-6">
          <Avatar name={profile.username} url={profile.avatar_url} seed={profile.id} size="xl" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h1 className="truncate text-3xl font-bold tracking-tight sm:text-4xl">{profile.username}</h1>
              <p className="text-sm text-muted">
                Producing since {new Date(profile.created_at).toLocaleDateString([], { month: "short", year: "numeric" })}
              </p>
            </div>
            {profile.bio ? (
              <p className="max-w-2xl text-[15px] whitespace-pre-line text-muted">{profile.bio}</p>
            ) : (
              isOwner && <p className="text-sm text-subtle">Add a bio so other producers know who they&apos;re up against.</p>
            )}
            {(profile.link_url || profile.daws.length > 0) && (
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2">
                <DawList daws={profile.daws} />
                <ProfileLink username={profile.username} linkUrl={profile.link_url} />
              </div>
            )}
          </div>
          {isOwner && (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" />
              Edit profile
            </Button>
          )}
        </div>
        <StatStrip
          stats={[
            { label: "Wins", value: profile.wins },
            { label: "Ties", value: profile.ties },
            { label: "Battles", value: profile.games_played },
            { label: "Win rate", value: winRate === null ? "–" : `${winRate}%` },
          ]}
        />
      </Card>

      <section className="flex flex-col gap-5">
        <Tabs label="Profile sections" items={[{ id: "recent", label: "Recent battles" }]} active="recent" />
        {history === null ? (
          <LobbyListSkeleton rows={3} />
        ) : history.length === 0 ? (
          <EmptyState>
            {isOwner ? "No finished battles yet. Your results will show up here." : "No shared battles to show yet."}
          </EmptyState>
        ) : (
          <div>
            <ListTable columns={COLUMNS}>
              {history.map((item) => (
                <HistoryRow key={item.key} item={item} />
              ))}
            </ListTable>
            {!isOwner && <p className="mt-4 text-xs text-subtle">Showing battles you were both part of.</p>}
          </div>
        )}
      </section>

      {isOwner && editing && (
        <ProfileEditor
          profile={profile}
          open={editing}
          onClose={() => setEditing(false)}
          onSaved={(updated) => {
            setEditing(false);
            if (updated.username !== profile.username) router.replace(`/u/${updated.username}`);
            else reload();
          }}
        />
      )}
    </div>
  );
}

function HistoryRow({ item }: { item: RoundHistoryItem }) {
  return (
    <ListRow
      thumb={
        <Thumb>
          <ModeIcon mode={item.mode} className="h-5 w-5 stroke-[1.5]" />
        </Thumb>
      }
      title={
        <>
          <span className="truncate">{modeName(item.mode)} battle</span>
          {item.isWinner && (
            <Badge tone="solid">
              <Trophy />
              {item.tied ? "Tie" : "Win"}
            </Badge>
          )}
        </>
      }
      subtitle={`${item.entrants} ${item.entrants === 1 ? "producer" : "producers"}`}
      cells={[
        <span key="p" className="font-semibold">
          #{item.rank}
          <span className="font-normal text-muted">/{item.entrants}</span>
        </span>,
        formatScore(item.avgScore),
        <span key="v" className="text-muted">{item.voteCount}</span>,
        <span key="d" className="text-muted">
          {item.playedAt ? new Date(item.playedAt).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : "–"}
        </span>,
      ]}
    />
  );
}
