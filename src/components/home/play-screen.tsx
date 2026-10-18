"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { AuthPanel } from "@/components/auth-panel";
import { useAuth } from "@/components/auth-provider";
import { LeaveRoomDialog } from "@/components/leave-room-dialog";
import { Card } from "@/components/ui/card";
import { ModeTooltipContent } from "@/components/mode-badge";
import { SelectCard } from "@/components/ui/select-card";
import { Tooltip } from "@/components/ui/tooltip";
import { Spinner } from "@/components/ui/spinner";
import { TabPanels, Tabs } from "@/components/ui/tabs";
import { useCurrentRoom } from "@/hooks/use-current-room";
import { useOnHide } from "@/hooks/use-on-hide";
import { usePublicRooms } from "@/hooks/use-public-rooms";
import { quickMatch } from "@/lib/game/rpc";
import { MODES } from "@/lib/game/room-settings";
import type { RoomMode } from "@/lib/game/types";
import { getBrowserClient } from "@/lib/supabase/client";
import { EmptyState, LobbyListSkeleton, RoomSections } from "./lobby-list";
import { ModeIcon } from "./mode-icon";
import { notifyError } from "@/lib/ui/notify";

type View = "lobbies" | "queue";

export function PlayScreen() {
  const { status } = useAuth();
  const [view, setView] = useState<View>("lobbies");
  const tabIds = useId();

  if (status === "loading") return <div className="h-96 animate-pulse rounded-2xl bg-surface" />;
  if (status !== "signed_in") {
    return (
      <Card className="max-w-xl p-6 sm:p-8">
        <h2 className="text-2xl font-bold tracking-tight">Pick a name to play</h2>
        <p className="mt-1 mb-6 text-sm text-muted">Play as a guest right away, or sign in to keep your stats.</p>
        <AuthPanel />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <Tabs
        label="Play mode"
        items={[
          { id: "lobbies", label: "Lobbies" },
          { id: "queue", label: "Queue" },
        ]}
        active={view}
        onChange={setView}
        ids={tabIds}
      />
      <TabPanels
        active={view}
        ids={tabIds}
        panels={[
          { id: "lobbies", content: <LobbiesPanel /> },
          { id: "queue", content: <QueuePanel /> },
        ]}
      />
    </div>
  );
}

function LobbiesPanel() {
  const { rooms, error } = usePublicRooms(true);

  if (rooms === null) return error ? <EmptyState>Couldn&apos;t load lobbies. Retrying…</EmptyState> : <LobbyListSkeleton rows={4} />;
  return <RoomSections rooms={rooms} emptyOpen="No open lobbies right now. Create one or try the queue." />;
}

function QueuePanel() {
  const router = useRouter();
  const { user } = useAuth();
  const { room: currentRoom } = useCurrentRoom(user?.id ?? null);
  const [mode, setMode] = useState<RoomMode>("classic");
  const [finding, setFinding] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useOnHide(() => {
    setFinding(false);
    setConfirming(false);
  });

  async function find() {
    setConfirming(false);
    setFinding(true);
    try {
      const { code } = await quickMatch(getBrowserClient(), mode);
      router.push(`/room/${code}`);
    } catch (e) {
      notifyError(e, "Couldn't find a lobby. Please try again.");
      setFinding(false);
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <p className="text-sm text-muted">Pick a mode and we&apos;ll drop you into an open lobby, or start one if none are waiting.</p>
      <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Mode">
        {MODES.map((m) => (
          <Tooltip key={m.id} focusable={false} content={<ModeTooltipContent room={{ mode: m.id }} />} className="flex">
            <SelectCard
              selected={mode === m.id}
              onSelect={() => setMode(m.id)}
              icon={<ModeIcon mode={m.id} />}
              title={m.name}
              description={m.blurb}
              className="flex-1"
            />
          </Tooltip>
        ))}
      </div>
      <button
        onClick={() => (currentRoom ? setConfirming(true) : void find())}
        disabled={finding}
        className="flex h-20 items-center justify-center gap-3 rounded-lg bg-fg text-2xl font-black tracking-tight text-page uppercase transition hover:bg-white/85 disabled:opacity-80"
      >
        {finding ? (
          <>
            <Spinner className="h-6 w-6" />
            <span className="text-lg normal-case">Finding a lobby…</span>
          </>
        ) : (
          <>
            <Search className="h-6 w-6" />
            Find match
          </>
        )}
      </button>
      {currentRoom && (
        <LeaveRoomDialog
          open={confirming}
          currentCode={currentRoom.code}
          action="Finding a match"
          onCancel={() => setConfirming(false)}
          onConfirm={() => void find()}
        />
      )}
    </div>
  );
}
