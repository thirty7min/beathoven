"use client";

import { AudioLines, Check, Crown, UserX, X } from "lucide-react";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { KebabMenu, type KebabItem } from "@/components/ui/kebab-menu";
import { cn } from "@/components/ui/cn";
import { List, ListRow } from "@/components/ui/list";
import { formatClock } from "@/lib/game/format";
import { kickActionFor, kickVoteFor } from "@/lib/game/kick";
import { activePlayers, hasSubmitted, memberBadge } from "@/lib/game/lobby";
import { currentSubmission } from "@/lib/game/phase";
import { revealedProducer } from "@/lib/game/room-extras";
import { activeSpectators } from "@/lib/game/spectate";
import type { RoomPlayer, RoomSnapshot } from "@/lib/game/types";
import { ProfileCard, prefetchProfile } from "./profile-card";
import { displayName } from "@/lib/ui/display-name";

export function PlayerList({
  snapshot,
  className,
  now,
  onRemoveBot,
  onKick,
  onVoteKick,
}: {
  snapshot: RoomSnapshot;
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
  const spectators = activeSpectators(snapshot.players);
  const playingId = revealedProducer(snapshot, currentSubmission(snapshot.room, snapshot.submissions))?.user_id ?? null;

  return (
    <section className={cn("flex min-h-0 flex-col", className)} aria-label="Players">
      <div className="scrollbar-thin -mx-1 min-h-0 overflow-y-auto px-1">
        <List>
          {players.map((player) => {
            const badge = memberBadge(snapshot, player.user_id, playingId);
            const submitted = hasSubmitted(snapshot, player.user_id);
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
                onPrefetch={() => void prefetchProfile(player.user_id)}
                thumb={
                  <span className="relative inline-flex">
                    <Avatar name={displayName(player)} url={player.avatar_url} seed={player.user_id} size="md" />
                    {submitted && (
                      <span
                        role="img"
                        aria-label="Submitted"
                        className="animate-ring pointer-events-none absolute -inset-1 rounded-full border-2 border-online"
                      />
                    )}
                  </span>
                }
                title={
                  <>
                    <span className="truncate text-sm">{displayName(player)}</span>
                    {player.user_id === snapshot.me && <Badge tone="outline">You</Badge>}
                    {player.is_bot && <Badge>Bot</Badge>}
                  </>
                }
                trailing={
                  <span className="flex items-center gap-2">
                    {vote && (
                      <span className="animate-swap text-[11px] font-semibold text-muted tabular-nums">
                        Kick vote {vote.votes}/{vote.needed}
                        {voteLeftMs !== null && ` · ${formatClock(voteLeftMs)}`}
                      </span>
                    )}
                    {badge === "playing" ? (
                      <Badge tone="solid">
                        <AudioLines />
                        <span className="sr-only">Playing</span>
                      </Badge>
                    ) : badge === "ready" ? (
                      <Badge tone="outline" className="animate-swap">
                        <Check />
                        Ready
                      </Badge>
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
                        aria-label={`Remove ${displayName(player)}`}
                        className="rounded-full p-1 text-subtle transition hover:bg-white/[0.06] hover:text-fg"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {menu.length > 0 && <KebabMenu items={menu} label={`Actions for ${displayName(player)}`} />}
                  </span>
                }
              />
            );
          })}
        </List>
        {spectators.length > 0 && (
          <section aria-label="Spectators" className="mt-2 border-t border-line pt-4">
            <Eyebrow className="tabular-nums">Spectators ({spectators.length})</Eyebrow>
            <List className="mt-1">
              {spectators.map((spectator) => (
                <ListRow
                  key={spectator.user_id}
                  className="grid-cols-[minmax(0,1fr)_auto] px-0 py-2"
                  onClick={() => setSelected(spectator)}
                  onPrefetch={() => void prefetchProfile(spectator.user_id)}
                  thumb={<Avatar name={displayName(spectator)} url={spectator.avatar_url} seed={spectator.user_id} size="sm" />}
                  title={
                    <>
                      <span className="truncate text-sm text-muted">{displayName(spectator)}</span>
                      {spectator.user_id === snapshot.me && <Badge tone="outline">You</Badge>}
                    </>
                  }
                  trailing={
                    kickActionFor(snapshot, spectator) === "kick" &&
                    onKick && (
                      <KebabMenu
                        items={[{ label: "Kick", icon: <UserX />, danger: true, onSelect: () => setKicking(spectator) }]}
                        label={`Actions for ${displayName(spectator)}`}
                      />
                    )
                  }
                />
              ))}
            </List>
          </section>
        )}
      </div>
      <Dialog open={kicking !== null} onClose={() => setKicking(null)} title={`Kick ${kicking ? displayName(kicking) : ""}?`}>
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
        onClose={() => setSelected(null)}
      />
    </section>
  );
}
