"use client";

import { kickPlayer, voteKick } from "@/lib/game/kick";
import { getBrowserClient } from "@/lib/supabase/client";
import { useRoomAction } from "./use-room-action";

export function useKickActions(roomId: string) {
  const { run } = useRoomAction();
  return {
    onKick: (userId: string) => run("kick", () => kickPlayer(getBrowserClient(), roomId, userId)),
    onVoteKick: (userId: string) => void run("vote-kick", () => voteKick(getBrowserClient(), roomId, userId)),
  };
}
