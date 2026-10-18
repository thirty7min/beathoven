import type { RoomMode } from "./types";

// Must match the check constraints on public.rooms.
export const SETTINGS_LIMITS = {
  maxPlayers: { min: 2, max: 16 },
  produceSeconds: { min: 60, max: 7200 },
  listenSeconds: { min: 30, max: 60 },
} as const;

export const DEFAULT_SETTINGS = {
  maxPlayers: 8,
  produceSeconds: 1200,
  listenSeconds: 45,
  isPrivate: false,
};

export const PREMADE_UPLOAD_SECONDS = 180;

export const PRODUCE_OPTIONS_SECONDS = [300, 600, 900, 1200, 1800, 2700, 3600];

export const LISTEN_OPTIONS_SECONDS = [30, 35, 40, 45, 50, 55, 60];

export function withCurrent(options: number[], current: number): number[] {
  return options.includes(current) ? options : [...options, current].sort((a, b) => a - b);
}

export const MODES: { id: RoomMode; name: string; blurb: string }[] = [
  { id: "classic", name: "Classic", blurb: "Everyone gets the same random sample pack. Flip it into a beat." },
  { id: "creative", name: "Creative", blurb: "Get a random prompt, then make anything that fits. No other rules." },
  { id: "premade", name: "Premade", blurb: "Upload a finished track. 3 minutes to upload, no production." },
];

export function modeName(mode: RoomMode): string {
  return MODES.find((m) => m.id === mode)?.name ?? mode;
}

export function clamp(value: number, { min, max }: { min: number; max: number }): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours) return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  return rest ? `${minutes}m ${rest}s` : `${minutes} min`;
}

const CODE_ALPHABET = /[^A-Z0-9]/g;

export function normalizeRoomCode(input: string): string {
  return input.toUpperCase().replace(CODE_ALPHABET, "").slice(0, 6);
}

export function isRoomCode(code: string): boolean {
  return /^[A-Z0-9]{6}$/.test(code);
}

type RulesRoom = {
  mode: RoomMode;
  produce_seconds: number;
  max_players: number;
  is_private: boolean;
  reveal_names?: boolean;
  listen_seconds?: number | null;
};

export function hasCustomRules(room: RulesRoom): boolean {
  return (
    (room.mode !== "premade" && room.produce_seconds !== DEFAULT_SETTINGS.produceSeconds) ||
    room.max_players !== DEFAULT_SETTINGS.maxPlayers ||
    (room.listen_seconds != null && room.listen_seconds !== DEFAULT_SETTINGS.listenSeconds) ||
    room.reveal_names === true
  );
}

type RuleRoom = {
  mode: RoomMode;
  produce_seconds?: number;
  max_players?: number;
  listen_seconds?: number | null;
  reveal_names?: boolean;
};

export function customRuleNotes(room: RuleRoom): string[] {
  const notes: string[] = [];
  if (room.mode !== "premade" && room.produce_seconds !== undefined && room.produce_seconds !== DEFAULT_SETTINGS.produceSeconds) {
    notes.push(`${formatSeconds(room.produce_seconds)} to produce`);
  }
  if (room.listen_seconds != null && room.listen_seconds !== DEFAULT_SETTINGS.listenSeconds) notes.push(`Listen time ${room.listen_seconds}s per track`);
  if (room.max_players !== undefined && room.max_players !== DEFAULT_SETTINGS.maxPlayers) notes.push(`${room.max_players} players max`);
  if (room.reveal_names) notes.push("Names shown");
  return notes;
}

export function modeInfo(room: RuleRoom): { title: string; body: string; rules: string | null } {
  const mode = MODES.find((m) => m.id === room.mode);
  const notes = customRuleNotes(room);
  return { title: mode?.name ?? room.mode, body: mode?.blurb ?? "", rules: notes.length ? notes.join(" · ") : null };
}
