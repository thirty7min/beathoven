"use client";

import { useEffect, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import type { RoomRole, RoomStatus } from "@/lib/game/types";
import { useOnHide } from "./use-on-hide";

export type CurrentRoom = { id: string; code: string; status: RoomStatus; role: RoomRole };

export async function fetchCurrentRoom(userId: string): Promise<CurrentRoom | null> {
  const supabase = getBrowserClient();
  const { data: memberships, error } = await supabase
    .from("room_players")
    .select("room_id, joined_at, role")
    .eq("user_id", userId)
    .is("left_at", null)
    .order("joined_at", { ascending: false });
  if (error || !memberships.length) return null;
  const { data: rooms } = await supabase
    .from("rooms")
    .select("id, code, status")
    .in(
      "id",
      memberships.map((m) => m.room_id),
    )
    .neq("status", "closed");
  if (!rooms?.length) return null;
  const order = memberships.map((m) => m.room_id);
  const room = [...rooms].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))[0];
  return { ...room, role: memberships.find((m) => m.room_id === room.id)?.role ?? "player" };
}

const UNLOADED = { userId: null, room: null, loaded: false };

export function useCurrentRoom(userId: string | null) {
  const [state, setState] = useState<{ userId: string | null; room: CurrentRoom | null; loaded: boolean }>(UNLOADED);
  useOnHide(() => setState(UNLOADED));

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void fetchCurrentRoom(userId)
      .catch(() => null)
      .then((room) => {
        if (!cancelled) setState({ userId, room, loaded: true });
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const current = state.userId === userId ? state : { room: null, loaded: false };
  return { room: current.room, loading: Boolean(userId) && !current.loaded };
}
