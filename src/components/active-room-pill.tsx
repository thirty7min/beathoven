"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { activeRoomPill, showsReturnPill } from "@/lib/game/active-room";
import { useActiveRoom } from "./active-room-provider";
import { Badge } from "./ui/badge";

export function ActiveRoomPill() {
  const { room, pathname } = useActiveRoom();
  if (!showsReturnPill(room, pathname)) return null;
  const { title, status, genre } = activeRoomPill(room);

  return (
    <div className="flex min-w-0 flex-1 justify-center">
      <Link
        href={`/room/${room.code}`}
        aria-label={`Back to ${title}, ${status}`}
        className="animate-drop-in inline-flex h-9 max-w-full min-w-0 items-center gap-2 rounded-full border border-line-strong bg-surface pr-2.5 pl-3 text-[13px] font-medium text-fg transition hover:bg-white/[0.05]"
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-fg" aria-hidden />
        <span className="min-w-0 truncate">{title}</span>
        <span className="shrink-0 text-muted tabular-nums">{status}</span>
        {genre && <Badge className="hidden shrink-0 sm:inline-flex">{genre}</Badge>}
        <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />
      </Link>
    </div>
  );
}
