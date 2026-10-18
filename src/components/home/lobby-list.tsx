"use client";

import { Copy, Link2, Users } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import type { ReactNode } from "react";
import { ModeBadge } from "@/components/mode-badge";
import { Badge } from "@/components/ui/badge";
import { Eyebrow } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { KebabMenu } from "@/components/ui/kebab-menu";
import { List, Thumb } from "@/components/ui/list";
import { useServerNow } from "@/hooks/use-server-now";
import { ServerClock } from "@/lib/game/clock";
import { etaLabel, phaseStatusLine, roomTitle, splitRooms } from "@/lib/game/room-list";
import type { PublicRoom } from "@/lib/game/types";
import { notifyFailure } from "@/lib/ui/notify";
import { ModeIcon } from "./mode-icon";

const localClock = new ServerClock();

export function RoomSections({ rooms, emptyOpen }: { rooms: PublicRoom[]; emptyOpen?: ReactNode }) {
  const { open, inProgress } = splitRooms(rooms);
  const now = useServerNow(localClock, 1000);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-1">
        <SectionHeader label="Open" count={open.length} />
        {open.length === 0 ? (
          <p className="px-2 py-6 text-sm text-muted">{emptyOpen ?? "No open lobbies right now."}</p>
        ) : (
          <List>
            {open.map((room) => (
              <RoomRow key={room.id} room={room} now={now} />
            ))}
          </List>
        )}
      </section>
      {inProgress.length > 0 && (
        <section className="flex flex-col gap-1">
          <SectionHeader label="In progress" count={inProgress.length} />
          <List>
            {inProgress.map((room) => (
              <RoomRow key={room.id} room={room} now={now} />
            ))}
          </List>
        </section>
      )}
    </div>
  );
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 border-b border-line px-2 pb-2.5">
      <Eyebrow>{label}</Eyebrow>
      <span className="text-[11px] font-semibold text-subtle tabular-nums">{count}</span>
    </div>
  );
}

function RoomRow({ room, now }: { room: PublicRoom; now: number | null }) {
  const joinable = room.joinable;
  const full = room.status === "lobby" && !joinable;
  const phase = now !== null ? phaseStatusLine(room, now) : null;
  const eta = now !== null && room.status !== "lobby" ? etaLabel(room, now) : null;

  const body = (
    <>
      <Thumb>
        <ModeIcon mode={room.mode} className="h-5 w-5 stroke-[1.5]" />
      </Thumb>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-[15px] font-semibold">{roomTitle(room)}</span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
          <span className="flex items-center gap-1">
            {room.host_username ?? "No host"} ·
            <Users className="h-3 w-3" />
            <span className="tabular-nums">
              {room.player_count}/{room.max_players}
            </span>
          </span>
          <ModeBadge room={room} className="" />
          {full && <Badge>Full</Badge>}
          {phase && <span className="tabular-nums">{phase}</span>}
          {eta && <span>· {eta}</span>}
        </span>
      </span>
      <span className="shrink-0 font-mono text-sm tracking-wider text-muted">{room.code}</span>
    </>
  );

  const classes = "flex min-w-0 flex-1 items-center gap-3.5 px-2 py-3";
  return (
    <li className="flex animate-fade-in items-center gap-1">
      {joinable ? (
        <Link href={`/room/${room.code}`} className={cn(classes, "rounded-lg transition hover:bg-white/[0.04]")} aria-label={`Join ${roomTitle(room)}`}>
          {body}
        </Link>
      ) : (
        <div className={cn(classes, "opacity-50")} aria-disabled="true" title={full ? "This room is full" : "This game is in progress"}>
          {body}
        </div>
      )}
      <KebabMenu
        items={[
          { label: "Copy code", icon: <Copy />, onSelect: () => copyText(room.code, "Room code copied") },
          { label: "Copy invite link", icon: <Link2 />, onSelect: () => copyText(`${window.location.origin}/room/${room.code}`, "Invite link copied") },
        ]}
      />
    </li>
  );
}

function copyText(text: string, message: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success(message),
    () => notifyFailure("Couldn't copy."),
  );
}

export function LobbyListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col divide-y divide-line">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3.5 px-2 py-3">
          <span className="h-12 w-12 animate-pulse rounded-md bg-raised" />
          <span className="flex flex-col gap-2">
            <span className="h-3.5 w-40 animate-pulse rounded bg-raised" />
            <span className="h-3 w-20 animate-pulse rounded bg-raised" />
          </span>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line px-4 py-12 text-center text-sm text-muted">{children}</p>;
}
