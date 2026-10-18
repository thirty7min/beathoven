"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { createContext, use, useEffect, useState, type ReactNode } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import { useAuth } from "./auth-provider";

export const ONLINE_TOPIC = "online";

const OnlineContext = createContext<ReadonlySet<string> | null>(null);

export function PresenceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [online, setOnline] = useState<ReadonlySet<string> | null>(null);

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
          if (channel) setOnline(new Set(Object.keys(channel.presenceState())));
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") void channel?.track({ online_at: new Date().toISOString() });
        });
    });

    return () => {
      cancelled = true;
      setOnline(null);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [userId]);

  return <OnlineContext value={online}>{children}</OnlineContext>;
}

export function useOnlineCount() {
  return use(OnlineContext)?.size ?? null;
}

export function useIsOnline(userId: string | null) {
  const online = use(OnlineContext);
  return userId !== null && (online?.has(userId) ?? false);
}
