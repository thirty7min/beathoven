"use client";

import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { AuthPanel } from "@/components/auth-panel";
import { EmptyState, LobbyListSkeleton, RoomSections } from "@/components/home/lobby-list";
import { ModeIcon } from "@/components/home/mode-icon";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { SearchInput } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { SelectCard } from "@/components/ui/select-card";
import { usePublicRooms } from "@/hooks/use-public-rooms";
import { PLAYABLE_MODES } from "@/lib/game/room-settings";
import type { RoomMode } from "@/lib/game/types";

export function LobbiesScreen() {
  const { status } = useAuth();
  const signedIn = status === "signed_in";
  const { rooms, error, refreshing, refresh } = usePublicRooms(signedIn);
  const [mode, setMode] = useState<RoomMode | "all">("all");
  const [query, setQuery] = useState("");
  const [hasSpace, setHasSpace] = useState(false);

  if (status === "loading") return <div className="h-96 animate-pulse rounded-2xl bg-surface" />;
  if (!signedIn) {
    return (
      <Card className="max-w-xl p-6 sm:p-8">
        <h2 className="text-xl font-bold">Sign in to browse lobbies</h2>
        <p className="mt-1 mb-6 text-sm text-muted">Pick a name to play as a guest, or sign in to keep your stats.</p>
        <AuthPanel />
      </Card>
    );
  }

  const all = rooms ?? [];
  const needle = query.trim().toLowerCase();
  const visible = all.filter(
    (r) =>
      (mode === "all" || r.mode === mode) &&
      (!hasSpace || r.player_count < r.max_players) &&
      (!needle || [r.code, r.host_username, r.host_display_name, r.name].some((v) => (v ?? "").toLowerCase().includes(needle))),
  );
  const countFor = (m: RoomMode | "all") => all.filter((r) => m === "all" || r.mode === m).length;

  return (
    <div className="flex flex-col gap-8">
      <div className={PLAYABLE_MODES.length === 3 ? "grid grid-cols-2 gap-3 lg:grid-cols-4" : "grid grid-cols-3 gap-3"}>
        <SelectCard selected={mode === "all"} onSelect={() => setMode("all")} title="All" value={rooms ? countFor("all") : "–"} />
        {PLAYABLE_MODES.map((m) => (
          <SelectCard
            key={m.id}
            selected={mode === m.id}
            onSelect={() => setMode(m.id)}
            icon={<ModeIcon mode={m.id} />}
            title={m.name}
            value={rooms ? countFor(m.id) : "–"}
          />
        ))}
      </div>


      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, host or code"
          aria-label="Search lobbies"
          className="w-full sm:w-80"
        />
        <Pill selected={hasSpace} onClick={() => setHasSpace((v) => !v)}>
          Has space
        </Pill>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="font-semibold tabular-nums">
            {visible.length} {visible.length === 1 ? "room" : "rooms"}
          </span>
          <button
            onClick={() => void refresh()}
            aria-label="Refresh lobbies"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-line-strong text-muted transition hover:text-fg"
          >
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
          </button>
        </div>
      </div>

      {rooms === null ? (
        error ? <EmptyState>Couldn&apos;t load lobbies. Retrying…</EmptyState> : <LobbyListSkeleton rows={5} />
      ) : visible.length === 0 ? (
        <EmptyState>{all.length === 0 ? "No public rooms right now. Host one from Play." : "No lobbies match those filters."}</EmptyState>
      ) : (
        <RoomSections rooms={visible} emptyOpen="No open lobbies match. Try another mode or create one from Play." />
      )}
    </div>
  );
}
