import { isSpectator } from "./spectate";
import type { RoomPlayer, RoomSnapshot } from "./types";

export { transferHost } from "./rpc";

export function canMakeHost(snapshot: Pick<RoomSnapshot, "room" | "me">, target: RoomPlayer): boolean {
  return (
    snapshot.room.status === "lobby" &&
    snapshot.room.host_id === snapshot.me &&
    target.user_id !== snapshot.me &&
    target.left_at === null &&
    !target.is_bot &&
    !isSpectator(target)
  );
}
