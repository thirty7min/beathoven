import type { RoomRole, RoomStatus } from "./types";

export function leaveNeedsConfirm(status: RoomStatus, role: RoomRole = "player"): boolean {
  if (role === "spectator") return false;
  return status === "producing" || status === "listening" || status === "reviewing";
}
