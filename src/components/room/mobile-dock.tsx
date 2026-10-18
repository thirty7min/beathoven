"use client";

import { MessageSquare, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Tabs } from "@/components/ui/tabs";
import { activePlayers } from "@/lib/game/lobby";
import type { RoomSnapshot } from "@/lib/game/types";
import { ChatPanel } from "./chat-panel";
import { PlayerList } from "./player-list";

type Props = {
  snapshot: RoomSnapshot;
  online: string[];
  onSend: (body: string) => Promise<unknown>;
  now: number | null;
  onKick: (userId: string) => Promise<unknown>;
  onVoteKick: (userId: string) => void;
};

type Tab = "chat" | "players";

export function MobileDock({ snapshot, online, onSend, now, onKick, onVoteKick }: Props) {
  const [open, setOpen] = useState<Tab | null>(null);
  const latestId = snapshot.chat.at(-1)?.id ?? 0;
  const [seen, setSeen] = useState(latestId);
  const unread = open === "chat" ? 0 : snapshot.chat.filter((m) => m.id > seen && m.user_id !== snapshot.me).length;
  const count = activePlayers(snapshot.players).length;

  const show = (tab: Tab | null) => {
    if (open === "chat") setSeen(latestId);
    setOpen(tab);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSeen((prev) => (open === "chat" ? latestId : prev));
      setOpen(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, latestId]);

  return (
    <div className="lg:hidden">
      <div className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-2 gap-2 border-t border-line bg-page/95 p-3 backdrop-blur-md">
        <button onClick={() => show("players")} className="flex h-11 items-center justify-center gap-2 rounded-full bg-raised text-sm font-semibold">
          <Users className="h-4 w-4 text-muted" />
          Players <span className="text-muted tabular-nums">{count}</span>
        </button>
        <button onClick={() => show("chat")} className="relative flex h-11 items-center justify-center gap-2 rounded-full bg-raised text-sm font-semibold">
          <MessageSquare className="h-4 w-4 text-muted" />
          Chat
          {unread > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-fg px-1.5 text-[11px] font-bold text-page tabular-nums">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end">
          <button aria-label="Close" className="absolute inset-0 bg-black/70" onClick={() => show(null)} />
          <div role="dialog" aria-modal="true" aria-label={open === "chat" ? "Chat" : "Players"} className="relative flex h-[80dvh] animate-sheet flex-col rounded-t-2xl border-t border-line bg-surface">
            <div className="flex items-center gap-4 px-5 pt-3">
              <Tabs
                label="Room panel"
                items={[
                  { id: "players", label: "Players", count },
                  { id: "chat", label: "Chat" },
                ]}
                active={open}
                onChange={show}
                className="flex-1"
              />
              <button onClick={() => show(null)} aria-label="Close" className="rounded-full p-1.5 text-muted hover:bg-white/[0.06] hover:text-fg">
                <X className="h-5 w-5" />
              </button>
            </div>
            {open === "players" ? (
              <PlayerList snapshot={snapshot} online={online} className="min-h-0 flex-1 px-5 py-2" now={now} onKick={onKick} onVoteKick={onVoteKick} />
            ) : (
              <ChatPanel messages={snapshot.chat} me={snapshot.me} hostId={snapshot.room.host_id} players={snapshot.players} online={online} onSend={onSend} className="min-h-0 flex-1" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
