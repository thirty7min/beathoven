"use client";

import { AudioLines, Check, Crown, UserX, X } from "lucide-react";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { KebabMenu, type KebabItem } from "@/components/ui/kebab-menu";
import { cn } from "@/components/ui/cn";
import { List, ListRow } from "@/components/ui/list";
import { formatClock } from "@/lib/game/format";
import { kickActionFor, kickVoteFor } from "@/lib/game/kick";
import { activePlayers, playerPhaseStatus } from "@/lib/game/lobby";
import { submitPhaseCopy } from "@/lib/game/phase-label";
import { currentSubmission } from "@/lib/game/phase";
import { revealedProducer } from "@/lib/game/room-extras";
import type { RoomPlayer, RoomSnapshot } from "@/lib/game/types";
import { ProfileCard } from "./profile-card";

const DONE_LABEL: Partial<Record<RoomSnapshot["room"]["status"], string>> = {
  lobby: "Ready",
  producing: "Submitted",
};

export function PlayerList({
  snapshot,
  online,
  className,
  now,
  onRemoveBot,
  onKick,
  onVoteKick,
}: {
  snapshot: RoomSnapshot;
  online: string[];
  className?: string;
  now?: number | null;
  onRemoveBot?: (userId: string) => void;
  onKick?: (userId: string) => Promise<unknown>;
  onVoteKick?: (userId: string) => void;
}) {
  const [selected, setSelected] = useState<RoomPlayer | null>(null);
  const [kicking, setKicking] = useState<RoomPlayer | null>(null);
  const [kickBusy, setKickBusy] = useState(false);
  const players = activePlayers(snapshot.players);
  const onlineSet = new Set(online);
  const presenceKnown = online.length > 0;
  const { status } = snapshot.room;
  const playingId = revealedProducer(snapshot, currentSubmission(snapshot.room, snapshot.submissions))?.user_id ?? null;

  return (
    <section className={cn("flex min-h-0 flex-col", className)} aria-label="Players">
      <List className="scrollbar-thin min-h-0 overflow-y-auto">
        {players.map((player) => {
          const isOnline = player.is_bot === true || onlineSet.has(player.user_id) || (!presenceKnown && player.user_id === snapshot.me);
          const phase = DONE_LABEL[status] ? playerPhaseStatus(snapshot, player.user_id) : null;
          const isHost = snapshot.room.host_id === player.user_id;
          const vote = kickVoteFor(snapshot, player.user_id);
          const voteLeftMs = vote && now != null ? Math.max(0, Date.parse(vote.expires_at) - now) : null;
          const action = kickActionFor(snapshot, player);
          const menu: KebabItem[] =
            action === "kick" && onKick
              ? [{ label: "Kick", icon: <UserX />, danger: true, onSelect: () => setKicking(player) }]
              : action === "vote" && onVoteKick
                ? [{ label: "Vote to kick", icon: <UserX />, onSelect: () => onVoteKick(player.user_id) }]
                : action === "voted"
                  ? [{ label: `Voted to kick${vote ? ` (${vote.votes}/${vote.needed})` : ""}`, icon: <Check />, disabled: true, onSelect: () => undefined }]
                  : [];
          return (
            <ListRow
              key={player.user_id}
              className="grid-cols-[minmax(0,1fr)_auto] px-0 py-2.5"
              onClick={() => setSelected(player)}
              thumb={
                <span className="relative">
                  <Avatar name={player.username} url={player.avatar_url} seed={player.user_id} size="md" className={cn(!isOnline && "opacity-40")} />
                  <span
                    aria-label={isOnline ? "online" : "away"}
                    className={cn("absolute -right-1 -bottom-1 h-3 w-3 rounded-full border-2 border-surface", isOnline ? "bg-online" : "bg-subtle")}
                  />
                </span>
              }
              title={
                <>
                  <span className={cn("truncate text-sm", !isOnline && "text-muted")}>{player.username}</span>
                  {player.user_id === snapshot.me && <Badge tone="outline">You</Badge>}
                  {player.is_bot && <Badge>Bot</Badge>}
                </>
              }
              subtitle={isOnline ? undefined : "Away"}
              trailing={
                <span className="flex items-center gap-2">
                  {vote && (
                    <span className="animate-swap text-[11px] font-semibold text-muted tabular-nums">
                      Kick vote {vote.votes}/{vote.needed}
                      {voteLeftMs !== null && ` · ${formatClock(voteLeftMs)}`}
                    </span>
                  )}
                  {player.user_id === playingId ? (
                    <Badge tone="solid">
                      <AudioLines />
                      Playing
                    </Badge>
                  ) : isHost && status === "lobby" ? null : phase === "done" ? (
                    <Badge tone="outline">
                      <Check />
                      {DONE_LABEL[status]}
                    </Badge>
                  ) : phase === "waiting" && status === "producing" ? (
                    <span className="text-xs text-subtle">{submitPhaseCopy(snapshot.room.mode).waiting}</span>
                  ) : null}
                  {isHost && (
                    <Badge tone="solid">
                      <Crown />
                      Host
                    </Badge>
                  )}
                  {player.is_bot && onRemoveBot && menu.length === 0 && (
                    <button
                      onClick={() => onRemoveBot(player.user_id)}
                      aria-label={`Remove ${player.username}`}
                      className="rounded-full p-1 text-subtle transition hover:bg-white/[0.06] hover:text-fg"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {menu.length > 0 && <KebabMenu items={menu} label={`Actions for ${player.username}`} />}
                </span>
              }
            />
          );
        })}
      </List>
      <Dialog open={kicking !== null} onClose={() => setKicking(null)} title={`Kick ${kicking?.username ?? ""}?`}>
        <p className="text-sm text-muted">They won&apos;t be able to rejoin this room.</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setKicking(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={kickBusy}
            onClick={async () => {
              if (!kicking || !onKick) return;
              setKickBusy(true);
              await onKick(kicking.user_id);
              setKickBusy(false);
              setKicking(null);
            }}
          >
            Kick
          </Button>
        </div>
      </Dialog>
      <ProfileCard
        player={selected}
        isHost={selected?.user_id === snapshot.room.host_id}
        online={selected ? onlineSet.has(selected.user_id) : false}
        onClose={() => setSelected(null)}
      />
    </section>
  );
}
