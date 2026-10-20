"use client";

import { transferHost } from "@/lib/game/host";
import { kickPlayer, voteKick } from "@/lib/game/kick";
import { getBrowserClient } from "@/lib/supabase/client";
import { useRoomAction } from "./use-room-action";

export function useKickActions(roomId: string) {
  const { run } = useRoomAction();
  return {
    onKick: (userId: string) => run("kick", () => kickPlayer(getBrowserClient(), roomId, userId)),
    onVoteKick: (userId: string) => void run("vote-kick", () => voteKick(getBrowserClient(), roomId, userId)),
    onMakeHost: async (userId: string) =>
      (await run("make-host", async () => {
        await transferHost(getBrowserClient(), roomId, userId);
        return true;
      })) ?? false,
  };
}
