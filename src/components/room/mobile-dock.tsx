"use client";

import { MessageSquare, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/components/ui/cn";
import { TabPanels, Tabs } from "@/components/ui/tabs";
import { activePlayers } from "@/lib/game/lobby";
import type { RoomSnapshot } from "@/lib/game/types";
import { ChatPanel } from "./chat-panel";
import { PlayerList } from "./player-list";

type Props = {
  snapshot: RoomSnapshot;
  onSend: (body: string) => Promise<unknown>;
  now: number | null;
  glass: boolean;
  onKick: (userId: string) => Promise<unknown>;
  onVoteKick: (userId: string) => void;
};

type Tab = "chat" | "players";

export function MobileDock({ snapshot, onSend, now, glass, onKick, onVoteKick }: Props) {
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
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-30 grid grid-cols-2 gap-2 border-t border-line p-3 transition-[background-color] duration-200 ease-snappy",
          glass ? "bg-black/50 backdrop-blur-lg" : "bg-page/95 backdrop-blur-md",
        )}
      >
        <button onClick={() => show("players")} className={cn("flex h-11 items-center justify-center gap-2 rounded-full text-sm font-semibold", dockButton(glass))}>
          <Users className="h-4 w-4 text-muted" />
          Players <span className="text-muted tabular-nums">{count}</span>
        </button>
        <button onClick={() => show("chat")} className={cn("relative flex h-11 items-center justify-center gap-2 rounded-full text-sm font-semibold", dockButton(glass))}>
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
          <button aria-label="Close" className={cn("absolute inset-0", glass ? "bg-black/40" : "bg-black/70")} onClick={() => show(null)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={open === "chat" ? "Chat" : "Players"}
            className={cn("relative flex h-[80dvh] animate-sheet flex-col rounded-t-2xl border-t border-line", glass ? "bg-black/55 backdrop-blur-lg" : "bg-surface")}
          >
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
            <TabPanels
              active={open}
              className="min-h-0 flex-1 grid-rows-[minmax(0,1fr)]"
              panelClassName="flex min-h-0 flex-col"
              panels={[
                {
                  id: "players",
                  content: <PlayerList snapshot={snapshot} className="min-h-0 flex-1 px-5 py-2" now={now} onKick={onKick} onVoteKick={onVoteKick} />,
                },
                {
                  id: "chat",
                  content: (
                    <ChatPanel messages={snapshot.chat} me={snapshot.me} hostId={snapshot.room.host_id} players={snapshot.players} onSend={onSend} glass={glass} className="min-h-0 flex-1" />
                  ),
                },
              ]}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function dockButton(glass: boolean) {
  return cn("transition-[background-color] duration-200 ease-snappy", glass ? "bg-white/[0.08]" : "bg-raised");
}
