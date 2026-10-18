"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { createContext, use, useEffect, useState, type ReactNode } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import { useAuth } from "./auth-provider";

export const ONLINE_TOPIC = "online";

const OnlineContext = createContext<number | null>(null);

export function PresenceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!userId) return;
    const supabase = getBrowserClient();
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    void supabase.realtime.setAuth().then(() => {
      if (cancelled) return;
      channel = supabase.channel(ONLINE_TOPIC, { config: { private: true, presence: { key: userId } } });
      channel
        .on("presence", { event: "sync" }, () => {
          if (channel) setCount(Object.keys(channel.presenceState()).length);
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") void channel?.track({ online_at: new Date().toISOString() });
        });
    });

    return () => {
      cancelled = true;
      setCount(null);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [userId]);

  return <OnlineContext value={count}>{children}</OnlineContext>;
}

export function useOnlineCount() {
  return use(OnlineContext);
}
