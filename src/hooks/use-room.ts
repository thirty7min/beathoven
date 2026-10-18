"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import { RoomConnection } from "@/lib/game/room-connection";
import { initialRoomViewState } from "@/lib/game/room-store";

const getServerSnapshot = () => initialRoomViewState;

export function useRoom(code: string) {
  const connection = useMemo(() => new RoomConnection(getBrowserClient(), code), [code]);

  useEffect(() => {
    void connection.start();
    return () => connection.stop();
  }, [connection]);

  const state = useSyncExternalStore(connection.subscribe, connection.getState, getServerSnapshot);

  return {
    ...state,
    clock: connection.clock,
    actions: connection.actions,
    resync: () => connection.resync(),
  };
}
