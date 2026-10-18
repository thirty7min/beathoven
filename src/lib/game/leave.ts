import type { RoomStatus } from "./types";

export function leaveNeedsConfirm(status: RoomStatus): boolean {
  return status === "producing" || status === "listening" || status === "reviewing";
}
