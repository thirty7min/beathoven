import { DEFAULT_GENRE, genreLabel } from "./genres";
import { phaseLabel } from "./phase-label";
import { roomTitle } from "./room-list";
import type { ActiveRoom } from "./types";

export const HEARTBEAT_MS = 10_000;

export type ActiveRoomPill = { title: string; status: string; genre: string | null };

export function isRoomPath(pathname: string | null): boolean {
  return pathname?.startsWith("/room/") ?? false;
}

export function leavesRoomPage(previous: string | null, next: string): boolean {
  return isRoomPath(previous) && !isRoomPath(next);
}

export function shouldHeartbeat(room: ActiveRoom | null, pathname: string | null): boolean {
  return room !== null || isRoomPath(pathname);
}

export function showsReturnPill(room: ActiveRoom | null, pathname: string | null): room is ActiveRoom {
  return room !== null && room.status !== "closed" && pathname !== null && !isRoomPath(pathname);
}

export function activeRoomPill(room: ActiveRoom): ActiveRoomPill {
  const phase = phaseLabel(room.mode, room.status) ?? "";
  const status = room.status === "lobby" ? `${phase} · ${room.player_count}/${room.max_players}` : phase;
  return {
    title: roomTitle(room),
    status: room.role === "spectator" ? `Spectating · ${status}` : status,
    genre: room.genre && room.genre !== DEFAULT_GENRE ? genreLabel(room.genre) : null,
  };
}
