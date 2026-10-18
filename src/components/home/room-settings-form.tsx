"use client";

import { Input } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { ModeIcon } from "./mode-icon";
import { Segmented, SettingList, SettingRow, Stepper } from "@/components/ui/setting-row";
import { isUploadOnly, submitPhaseCopy } from "@/lib/game/phase-label";
import { ROOM_NAME_MAX } from "@/lib/game/room-list";
import {
  DEFAULT_SETTINGS,
  LISTEN_OPTIONS_SECONDS,
  MODES,
  PREMADE_UPLOAD_SECONDS,
  PRODUCE_OPTIONS_SECONDS,
  SETTINGS_LIMITS,
  formatSeconds,
  modeName,
  withCurrent,
} from "@/lib/game/room-settings";
import type { Room, RoomMode } from "@/lib/game/types";

export type RoomSettingsDraft = {
  mode: RoomMode;
  name: string;
  maxPlayers: number;
  produceSeconds: number;
  listenSeconds: number;
  isPrivate: boolean;
  revealNames: boolean;
};

export const DEFAULT_DRAFT: RoomSettingsDraft = { mode: "classic", name: "", ...DEFAULT_SETTINGS, revealNames: false };

const MODE_OPTIONS = MODES.map((m) => ({ value: m.id, label: m.name, description: m.blurb, icon: <ModeIcon mode={m.id} /> }));
const LISTEN_LABEL = "Listen time per track";
const NAMES_HINT = "Shown: everyone sees who made the track that's playing. Hidden: names appear in the results.";

const namesLabel = (mode: RoomMode) => (isUploadOnly(mode) ? "Artist names" : "Producer names");

export function RoomSettingsForm({
  value,
  onChange,
  minPlayers = SETTINGS_LIMITS.maxPlayers.min,
  namePlaceholder,
}: {
  value: RoomSettingsDraft;
  onChange: (next: RoomSettingsDraft) => void;
  minPlayers?: number;
  namePlaceholder?: string;
}) {
  const set = <K extends keyof RoomSettingsDraft>(key: K, v: RoomSettingsDraft[K]) => onChange({ ...value, [key]: v });
  const uploadOnly = isUploadOnly(value.mode);

  function selectMode(mode: RoomMode) {
    const produceSeconds = isUploadOnly(mode)
      ? PREMADE_UPLOAD_SECONDS
      : isUploadOnly(value.mode)
        ? DEFAULT_SETTINGS.produceSeconds
        : value.produceSeconds;
    onChange({ ...value, mode, produceSeconds });
  }

  return (
    <div className="flex flex-col gap-3">
      <Input
        aria-label="Room name"
        value={value.name}
        maxLength={ROOM_NAME_MAX}
        onChange={(e) => set("name", e.target.value)}
        placeholder={namePlaceholder ?? "Room name"}
      />
      <SettingList>
        <SettingRow label="Game mode">
          <Select label="Game mode" value={value.mode} options={MODE_OPTIONS} onChange={selectMode} />
        </SettingRow>
        <SettingRow label={submitPhaseCopy(value.mode).timeSetting}>
          {uploadOnly ? (
            <span className="text-muted">{formatSeconds(PREMADE_UPLOAD_SECONDS)} upload</span>
          ) : (
            <Select
              label="Produce time"
              value={value.produceSeconds}
              options={withCurrent(PRODUCE_OPTIONS_SECONDS, value.produceSeconds).map((s) => ({ value: s, label: formatSeconds(s) }))}
              onChange={(s) => set("produceSeconds", s)}
            />
          )}
        </SettingRow>
        <SettingRow label={LISTEN_LABEL}>
          <Select
            label={LISTEN_LABEL}
            value={value.listenSeconds}
            options={withCurrent(LISTEN_OPTIONS_SECONDS, value.listenSeconds).map((s) => ({ value: s, label: `${s}s` }))}
            onChange={(s) => set("listenSeconds", s)}
          />
        </SettingRow>
        <SettingRow label="Max players">
          <Stepper
            label="Max players"
            value={value.maxPlayers}
            min={Math.max(SETTINGS_LIMITS.maxPlayers.min, minPlayers)}
            max={SETTINGS_LIMITS.maxPlayers.max}
            onChange={(n) => set("maxPlayers", n)}
          />
        </SettingRow>
        <SettingRow label="Visibility">
          <Segmented
            label="Visibility"
            value={value.isPrivate ? "private" : "public"}
            options={[
              { value: "public", label: "Public" },
              { value: "private", label: "Private" },
            ]}
            onChange={(v) => set("isPrivate", v === "private")}
          />
        </SettingRow>
        <SettingRow label={namesLabel(value.mode)} hint={NAMES_HINT}>
          <Segmented
            label={namesLabel(value.mode)}
            value={value.revealNames ? "shown" : "hidden"}
            options={[
              { value: "hidden", label: "Hidden" },
              { value: "shown", label: "Shown" },
            ]}
            onChange={(v) => set("revealNames", v === "shown")}
          />
        </SettingRow>
      </SettingList>
    </div>
  );
}

export function RoomSettingsSummary({ room }: { room: Room }) {
  const mode = MODES.find((m) => m.id === room.mode);
  const listen = room.listen_seconds;

  return (
    <SettingList>
      <SettingRow label="Game mode" hint={mode?.blurb}>
        {modeName(room.mode)}
      </SettingRow>
      <SettingRow label={submitPhaseCopy(room.mode).timeSetting}>{formatSeconds(room.produce_seconds)}</SettingRow>
      <SettingRow label={LISTEN_LABEL}>{listen ? `${listen}s` : "Full track"}</SettingRow>
      <SettingRow label="Max players">{room.max_players}</SettingRow>
      <SettingRow label="Visibility">{room.is_private ? "Private" : "Public"}</SettingRow>
      <SettingRow label={namesLabel(room.mode)} hint={NAMES_HINT}>
        {room.reveal_names ? "Shown" : "Hidden"}
      </SettingRow>
    </SettingList>
  );
}
