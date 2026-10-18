"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { listPublicRooms } from "@/lib/game/rpc";
import type { PublicRoom } from "@/lib/game/types";
import { getBrowserClient } from "@/lib/supabase/client";

const REFRESH_MS = 7_000;

export function usePublicRooms(enabled: boolean) {
  const [rooms, setRooms] = useState<PublicRoom[] | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      setRooms(await listPublicRooms(getBrowserClient()));
      setError(false);
    } catch {
      setError(true);
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    tick();
    const id = setInterval(tick, REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, [enabled, refresh]);

  return { rooms, error, refreshing, refresh };
}
