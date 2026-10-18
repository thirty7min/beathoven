"use client";

import { Bot, Check, ChevronDown, ChevronUp, Copy, Info, Link2, LogOut, Settings, X } from "lucide-react";
import { useState } from "react";
import { RoomSettingsForm, RoomSettingsSummary, type RoomSettingsDraft } from "@/components/home/room-settings-form";
import { GenreBadge } from "@/components/genre-badge";
import { ModeBadge } from "@/components/mode-badge";
import { Button } from "@/components/ui/button";
import { Card, Eyebrow } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Dialog } from "@/components/ui/dialog";
import { useDevToolsEnabled } from "@/hooks/use-dev-tools";
import { addBot, removeBot } from "@/lib/game/dev-bots";
import { activePlayers, readyCount, startCheck } from "@/lib/game/lobby";
import { DEFAULT_GENRE } from "@/lib/game/genres";
import { autostartRemainingMs } from "@/lib/game/phase";
import { DEFAULT_SETTINGS, hasCustomRules } from "@/lib/game/room-settings";
import { isSpectating } from "@/lib/game/spectate";
import type { Room } from "@/lib/game/types";
import { ChatPanel } from "./chat-panel";
import { ConnectionBadge } from "./connection-badge";
import { PlayerList } from "./player-list";
import { SpectatingBadge } from "./spectating-badge";
import type { RoomController } from "./types";
import { useCopy } from "./use-copy";
import { useKickActions } from "./use-kick-actions";
import { useRoomAction } from "./use-room-action";
import { autostartView, type AutostartView } from "@/lib/ui/autostart";
import { displayName } from "@/lib/ui/display-name";

export function LobbyView({
  room,
  serverNow,
  onLeave,
  leaving,
}: {
  room: RoomController;
  serverNow: number | null;
  onLeave: () => void;
  leaving: boolean;
}) {
  const snapshot = room.snapshot!;
  const { me, room: state } = snapshot;
  const { pending, run } = useRoomAction();
  const { copy } = useCopy();
  const [confirmForce, setConfirmForce] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);

  const isHost = state.host_id === me;
  const spectating = isSpectating(snapshot);
  const devTools = useDevToolsEnabled(isHost);
  const kick = useKickActions(state.id);
  const meReady = snapshot.players.find((p) => p.user_id === me)?.is_ready ?? false;
  const check = startCheck(snapshot, room.connection === "live");
  const { ready, total } = readyCount(snapshot.players);
  const players = activePlayers(snapshot.players);
  const custom = hasCustomRules(state);
  const quietConnection = room.connection === "live" || room.connection === "connecting";
  const countdown = autostartView(serverNow === null ? null : autostartRemainingMs(state, serverNow));
  const counting = countdown !== null;
  const [wasCounting, setWasCounting] = useState(counting);
  const [cancelNotice, setCancelNotice] = useState(false);
  if (counting !== wasCounting) {
    setWasCounting(counting);
    setCancelNotice(!counting);
  }

  async function start(force: boolean) {
    await run(force ? "force" : "start", () => room.actions.startGame({ force }));
    setConfirmForce(false);
  }

  const caption =
    isHost && check.kind === "blocked" ? `${ready}/${total} ready · ${check.reason}` : `${ready}/${total} ready`;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <h1 className="truncate text-xl font-bold tracking-tight">{state.name || `Room ${state.code}`}</h1>
          <ModeBadge room={state} />
          <GenreBadge genre={state.genre} />
          {spectating && <SpectatingBadge />}
          {custom && (
            <button
              onClick={() => setDetailsOpen(true)}
              className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[11px] font-semibold text-muted transition hover:bg-white/[0.14] hover:text-fg"
            >
              Custom
            </button>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <ConnectionBadge status={room.connection} compact={quietConnection} />
          <button
            onClick={() => copy(state.code, "Room code copied")}
            aria-label={`Copy room code ${state.code}`}
            className="flex h-9 items-center gap-2 rounded-lg border border-line-strong px-3 font-mono text-sm font-semibold tracking-[0.18em] transition hover:border-fg"
          >
            {state.code}
            <Copy className="h-3.5 w-3.5 text-muted" />
          </button>
          <Button size="sm" variant="outline" className="h-9" onClick={() => copy(`${window.location.origin}/room/${state.code}`, "Invite link copied")}>
            <Link2 className="h-4 w-4" />
            <span className="hidden sm:inline">Invite</span>
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="h-9 w-9"
            onClick={() => setDetailsOpen(true)}
            aria-label={isHost ? "Room settings" : "Room details"}
          >
            {isHost ? <Settings className="h-4 w-4" /> : <Info className="h-4 w-4" />}
          </Button>
        </div>
      </header>

      <div className={cn("grid gap-4 lg:h-[calc(100dvh-11rem)] lg:min-h-[28rem]", chatCollapsed ? "lg:grid-cols-[minmax(0,1fr)_220px]" : "lg:grid-cols-[minmax(0,1fr)_380px]")}>
        <Card className="flex min-h-[22rem] flex-col lg:min-h-0">
          <div className="flex items-center justify-between px-5 pt-4 pb-1">
            <Eyebrow>Members</Eyebrow>
            <span className="flex items-center gap-3 text-xs text-muted tabular-nums">
              {devTools && players.length < state.max_players && (
                <button
                  onClick={() => run("bot", () => addBot(state.id))}
                  disabled={pending === "bot"}
                  className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-subtle transition hover:bg-white/[0.06] hover:text-fg disabled:opacity-40"
                >
                  <Bot className="h-3.5 w-3.5" />
                  Add bot
                </button>
              )}
              {players.length}/{state.max_players}
            </span>
          </div>
          <PlayerList
            snapshot={snapshot}
            className="flex-1 px-5"
            now={serverNow}
            {...kick}
            onRemoveBot={devTools ? (botId) => void run("remove-bot", () => removeBot(state.id, botId)) : undefined}
          />
          <div className="flex flex-col gap-2 border-t border-line p-4">
            {countdown ? (
              <AutostartBanner key="countdown" countdown={countdown} />
            ) : (
              cancelNotice && (
                <p key="cancelled" role="status" onAnimationEnd={() => setCancelNotice(false)} className="animate-notice pb-1 text-center text-sm text-muted">
                  Start cancelled
                </p>
              )
            )}
            <div className="flex gap-3">
              <Button variant="outline" size="lg" onClick={onLeave} loading={leaving} className="px-4" aria-label="Leave room">
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Leave room</span>
              </Button>
              {spectating ? (
                <p role="status" className="flex flex-1 animate-swap items-center rounded-full border border-line px-5 text-sm text-muted">
                  The room is full. You&apos;ll get the next open seat.
                </p>
              ) : (
                <>
                  <Button
                    variant={isHost || (meReady && !counting) ? "outline" : "primary"}
                    size="lg"
                    className={cn(!isHost && "flex-1", counting && meReady && isHost && "border-fg")}
                    aria-pressed={meReady}
                    loading={pending === "ready"}
                    onClick={() => run("ready", () => room.actions.setReady(!meReady))}
                  >
                    {counting && meReady ? (
                      <>
                        <X className="h-4 w-4" />
                        Unready
                      </>
                    ) : meReady ? (
                      <>
                        Ready <Check className="h-4 w-4" />
                      </>
                    ) : (
                      "Ready up"
                    )}
                  </Button>
                  {isHost &&
                    (counting ? (
                      <Button variant="primary" size="lg" className="flex-1" loading={pending === "start" || pending === "force"} onClick={() => start(check.kind !== "ready")}>
                        Start now
                      </Button>
                    ) : check.kind === "ready" ? (
                      <Button variant="primary" size="lg" className="flex-1" loading={pending === "start"} onClick={() => start(false)}>
                        Start
                      </Button>
                    ) : (
                      <Button variant="primary" size="lg" className="flex-1" disabled={check.kind !== "force"} onClick={() => setConfirmForce(true)}>
                        Force start
                      </Button>
                    ))}
                </>
              )}
            </div>
            <p className="text-right text-[11px] font-semibold tracking-[0.08em] text-muted uppercase tabular-nums">{caption}</p>
          </div>
        </Card>

        <Card className={cn("flex flex-col overflow-hidden", chatCollapsed ? "self-start" : "h-[28rem] lg:h-auto")}>
          <div className="flex items-center justify-between px-5 pt-4 pb-1">
            <Eyebrow>Chat</Eyebrow>
            <button
              onClick={() => setChatCollapsed((v) => !v)}
              aria-label={chatCollapsed ? "Show chat" : "Hide chat"}
              aria-expanded={!chatCollapsed}
              className="rounded-full p-1 text-muted transition hover:bg-white/[0.06] hover:text-fg"
            >
              {chatCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </button>
          </div>
          {chatCollapsed ? (
            <div className="pb-3" />
          ) : (
            <ChatPanel messages={snapshot.chat} me={me} hostId={state.host_id} players={snapshot.players} onSend={room.actions.sendChat} className="min-h-0 flex-1" />
          )}
        </Card>
      </div>

      {detailsOpen &&
        (isHost ? (
          <SettingsDialog
            room={state}
            minPlayers={players.length}
            hostName={displayName(players.find((p) => p.user_id === me), "")} onClose={() => setDetailsOpen(false)} onSave={room.actions.updateSettings} />
        ) : (
          <DetailsDialog room={state} onClose={() => setDetailsOpen(false)} />
        ))}

      <Dialog open={confirmForce} onClose={() => setConfirmForce(false)} title="Start without everyone ready?">
        <p className="text-sm text-muted">
          <span className="font-semibold text-fg tabular-nums">
            {ready}/{total} ready.
          </span>{" "}
          Anyone who isn&apos;t ready still plays, but the clock starts now.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmForce(false)}>
            Wait
          </Button>
          <Button variant="primary" loading={pending === "force"} onClick={() => start(true)}>
            Force start
          </Button>
        </div>
      </Dialog>

    </div>
  );
}

function DetailsDialog({ room, onClose }: { room: Room; onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} title="Room details" className="max-w-lg">
      <div className="flex flex-col gap-4">
        <RoomSettingsSummary room={room} />
        <p className="text-xs text-muted">Only the host can change these.</p>
      </div>
    </Dialog>
  );
}

function SettingsDialog({
  room,
  minPlayers,
  hostName,
  onClose,
  onSave,
}: {
  room: Room;
  minPlayers: number;
  hostName: string | undefined;
  onClose: () => void;
  onSave: RoomController["actions"]["updateSettings"];
}) {
  const { pending, run } = useRoomAction();
  const [draft, setDraft] = useState<RoomSettingsDraft>({
    mode: room.mode,
    name: room.name ?? "",
    genre: room.genre ?? DEFAULT_GENRE,
    maxPlayers: room.max_players,
    produceSeconds: room.produce_seconds,
    listenSeconds: room.listen_seconds ?? DEFAULT_SETTINGS.listenSeconds,
    isPrivate: room.is_private,
    revealNames: room.reveal_names ?? false,
  });

  async function save() {
    const saved = await run("save", async () => {
      await onSave({ ...draft, name: draft.name.trim() });
      return true;
    });
    if (saved) onClose();
  }

  return (
    <Dialog open onClose={onClose} title="Room settings" className="max-h-[92dvh] max-w-lg overflow-y-auto">
      <div className="flex flex-col gap-4">
        <RoomSettingsForm
          value={draft}
          onChange={setDraft}
          minPlayers={minPlayers}
          autoFocusName
          namePlaceholder={hostName ? `${hostName}'s room` : undefined}
        />
        <p className="text-xs text-muted">Changing the mode or timers resets everyone&apos;s ready state.</p>
        <div className="flex gap-2">
          <Button variant="ghost" size="lg" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="lg" className="flex-1" loading={pending === "save"} onClick={save}>
            Save
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function AutostartBanner({ countdown }: { countdown: AutostartView }) {
  return (
    <div role="timer" aria-live="polite" aria-atomic className="flex animate-swap items-center rounded-xl border border-line-strong bg-raised px-4 py-3">
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-semibold">Starting in {countdown.seconds}…</span>
          <span className="text-xs text-muted">Unready to cancel</span>
        </span>
        <span className="h-1 overflow-hidden rounded-full bg-white/10">
          <span
            className="block h-full origin-left rounded-full bg-fg transition-transform duration-250 ease-linear motion-reduce:transition-none"
            style={{ transform: `scaleX(${countdown.fraction})` }}
          />
        </span>
      </span>
    </div>
  );
}
