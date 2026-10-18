import { formatClock } from "./format";
import { UPLOAD_GRACE_MS, cappedRemaining } from "./phase";
import { phaseLabel } from "./phase-label";
import { PREMADE_UPLOAD_SECONDS } from "./room-settings";
import type { PublicRoom } from "./types";

export const ROOM_NAME_MAX = 40;

export function roomTitle(room: Pick<PublicRoom, "name" | "host_username">): string {
  const name = room.name?.trim();
  if (name) return name;
  return room.host_username ? `${room.host_username}'s room` : "Open room";
}

export function splitRooms<T extends Pick<PublicRoom, "status">>(rooms: T[]) {
  return {
    open: rooms.filter((r) => r.status === "lobby"),
    inProgress: rooms.filter((r) => r.status === "producing" || r.status === "listening" || r.status === "results"),
  };
}

export function phaseStatusLine(room: Pick<PublicRoom, "mode" | "status" | "phase_ends_at">, now: number): string | null {
  if (room.status === "lobby") return null;
  const label = phaseLabel(room.mode, room.status);
  if (!label) return null;
  if (!room.phase_ends_at) return label;
  const producing = room.status === "producing";
  const end = Date.parse(room.phase_ends_at) - (producing ? UPLOAD_GRACE_MS : 0);
  const cap = producing && room.mode === "premade" ? PREMADE_UPLOAD_SECONDS * 1000 : Infinity;
  return `${label} · ${formatClock(cappedRemaining(end, now, cap))}`;
}

export function etaLabel(room: Pick<PublicRoom, "estimated_end_at">, now: number): string | null {
  if (!room.estimated_end_at) return null;
  const minutes = Math.max(1, Math.ceil((Date.parse(room.estimated_end_at) - now) / 60_000));
  return `~${minutes}m to finish`;
}
