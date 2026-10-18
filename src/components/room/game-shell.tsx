"use client";

import { LogOut, MessageSquare, PanelLeftClose } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Logo } from "@/components/logo";
import { VolumeControl } from "@/components/volume-control";
import { GenreBadge } from "@/components/genre-badge";
import { ModeBadge } from "@/components/mode-badge";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Dialog } from "@/components/ui/dialog";
import { leaveNeedsConfirm } from "@/lib/game/leave";
import { activePlayers } from "@/lib/game/lobby";
import type { RoomSnapshot } from "@/lib/game/types";
import { ChatPanel } from "./chat-panel";
import { ConnectionBadge, ReconnectingNotice } from "./connection-badge";
import { PlayerList } from "./player-list";
import { MobileDock } from "./mobile-dock";
import { ShellBackdropProvider } from "./shell-backdrop";
import type { RoomController } from "./types";
import { useKickActions } from "./use-kick-actions";

export function GameShell({
  room,
  serverNow,
  onLeave,
  leaving,
  children,
}: {
  room: RoomController;
  serverNow: number | null;
  onLeave: () => void;
  leaving: boolean;
  children: ReactNode;
}) {
  const snapshot = room.snapshot!;
  const { room: state } = snapshot;
  const [chatOpen, setChatOpen] = useState(true);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const kick = useKickActions(state.id);
  const latestId = snapshot.chat.at(-1)?.id ?? 0;
  const [seen, setSeen] = useState(latestId);
  const unread = chatOpen ? 0 : snapshot.chat.filter((m) => m.id > seen && m.user_id !== snapshot.me).length;
  const [backdrop, setBackdrop] = useState<HTMLDivElement | null>(null);
  const glass = state.status === "listening";

  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previous;
    };
  }, []);

  function toggleChat() {
    setSeen(latestId);
    setChatOpen((open) => !open);
  }

  return (
    <div className="fixed inset-0 z-40 flex h-dvh flex-col bg-page">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4">
        <Logo collapse />
        <span className="min-w-0 truncate text-sm text-muted lg:hidden">{state.name || `Room ${state.code}`}</span>
        <div className="ml-auto flex items-center gap-1">
          <VolumeControl />
          <ConnectionBadge status={room.connection} compact />
          <Button size="sm" variant="outline" className="ml-1" loading={leaving && !confirmLeave} onClick={() => (leaveNeedsConfirm(state.status) ? setConfirmLeave(true) : onLeave())}>
            <LogOut className="h-4 w-4" />
            Leave
          </Button>
        </div>
      </header>

      {room.connection === "reconnecting" && <ReconnectingNotice className="rounded-none border-x-0 border-t-0" />}

      <div className="relative flex min-h-0 flex-1">
        <div ref={setBackdrop} className="absolute inset-0 -z-10" />
        {chatOpen ? (
          <aside className={cn("hidden w-[320px] shrink-0 flex-col border-r border-line lg:flex", panelSurface(glass))}>
            <div className="flex items-center justify-between px-4 pt-4 pb-1">
              <Eyebrow>Chat</Eyebrow>
              <button
                onClick={toggleChat}
                aria-label="Hide chat"
                className="rounded-full p-1.5 text-muted transition hover:bg-white/[0.06] hover:text-fg"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>
            <ChatPanel messages={snapshot.chat} me={snapshot.me} hostId={state.host_id} players={snapshot.players} onSend={room.actions.sendChat} glass={glass} className="flex-1" />
          </aside>
        ) : (
          <button
            onClick={toggleChat}
            aria-label={unread ? `Show chat, ${unread} unread` : "Show chat"}
            className={cn(
              "hidden w-10 shrink-0 flex-col items-center justify-center gap-3 border-r border-line text-muted transition-[background-color,color] duration-200 ease-snappy hover:text-fg lg:flex",
              glass ? "bg-black/50 backdrop-blur-lg hover:bg-black/40" : "bg-page hover:bg-white/[0.03]",
            )}
          >
            <MessageSquare className="h-4 w-4" />
            <span className="text-[11px] font-semibold tracking-[0.2em] uppercase [writing-mode:vertical-rl]">Chat</span>
            {unread > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-fg px-1 text-[11px] font-bold text-page tabular-nums">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </button>
        )}

        <main className="scrollbar-thin relative min-w-0 flex-1 overflow-y-auto pb-20 lg:pb-0">
          <ShellBackdropProvider value={backdrop}>{children}</ShellBackdropProvider>
        </main>

        <aside className={cn("hidden w-[300px] shrink-0 flex-col border-l border-line lg:flex xl:w-[320px]", panelSurface(glass))}>
          <RoomInfo snapshot={snapshot} />
          <div className="flex min-h-0 flex-1 flex-col border-t border-line px-5 pt-4">
            <div className="flex items-center justify-between pb-1">
              <Eyebrow>Players</Eyebrow>
              <span className="text-xs text-muted tabular-nums">
                {activePlayers(snapshot.players).length}/{state.max_players}
              </span>
            </div>
            <PlayerList snapshot={snapshot} className="min-h-0 flex-1 pb-3" now={serverNow} {...kick} />
          </div>
        </aside>
      </div>

      <MobileDock snapshot={snapshot} onSend={room.actions.sendChat} now={serverNow} glass={glass} {...kick} />

      <Dialog open={confirmLeave && leaveNeedsConfirm(state.status)} onClose={() => setConfirmLeave(false)} title="Leave this game?">
        <p className="text-sm text-muted">The game is still going. If you leave now you&apos;ll miss the rest and can&apos;t rejoin until it ends.</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmLeave(false)}>
            Stay
          </Button>
          <Button variant="danger" loading={leaving} onClick={onLeave}>
            Leave room
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function panelSurface(glass: boolean) {
  return cn("transition-[background-color] duration-200 ease-snappy", glass ? "bg-black/50 backdrop-blur-lg" : "bg-page");
}

function RoomInfo({ snapshot }: { snapshot: RoomSnapshot }) {
  const { room } = snapshot;
  const prompt = room.mode === "creative" ? snapshot.assets.find((a) => a.kind === "prompt")?.prompt : null;

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-2">
        <p className="truncate text-lg leading-tight font-bold">{room.name || `Room ${room.code}`}</p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <ModeBadge room={room} />
          <GenreBadge genre={room.genre} />
          <span className="font-mono tracking-wider">{room.code}</span>
        </div>
      </div>
      {prompt && (
        <div className="flex flex-col gap-1">
          <Eyebrow>Prompt</Eyebrow>
          <p className="text-sm font-semibold text-balance">&ldquo;{prompt}&rdquo;</p>
        </div>
      )}
    </div>
  );
}
