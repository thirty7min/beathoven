"use client";

import { usePathname } from "next/navigation";
import { Suspense, createContext, use, useCallback, useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { HEARTBEAT_MS, leavesRoomPage, shouldHeartbeat } from "@/lib/game/active-room";
import { roomHeartbeat } from "@/lib/game/rpc";
import { startTicker } from "@/lib/game/ticker";
import type { ActiveRoom } from "@/lib/game/types";
import { getBrowserClient } from "@/lib/supabase/client";
import { useAuth } from "./auth-provider";

type ActiveRoomState = { room: ActiveRoom | null; pathname: string | null };

const ActiveRoomContext = createContext<ActiveRoomState>({ room: null, pathname: null });

export function ActiveRoomProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [pathname, setPathname] = useState<string | null>(null);
  const [state, setState] = useState<{ userId: string; room: ActiveRoom | null } | null>(null);
  const latest = useRef(0);
  const lastPathname = useRef<string | null>(null);
  const room = state && state.userId === userId ? state.room : null;
  const ticking = userId !== null && shouldHeartbeat(room, pathname);

  const beat = useEffectEvent(() => {
    if (!userId) return;
    const seq = ++latest.current;
    void roomHeartbeat(getBrowserClient()).then(
      (next) => {
        if (seq === latest.current) setState({ userId, room: next });
      },
      () => undefined,
    );
  });

  const changePathname = useCallback((next: string) => {
    if (leavesRoomPage(lastPathname.current, next)) {
      latest.current++;
      setState(null);
    }
    lastPathname.current = next;
    setPathname(next);
  }, []);

  useEffect(() => {
    beat();
  }, [userId, pathname]);

  useEffect(() => {
    if (!ticking) return;
    const stop = startTicker(HEARTBEAT_MS, beat);
    const wake = () => {
      if (document.visibilityState === "visible") beat();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    window.addEventListener("pageshow", wake);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("pageshow", wake);
    };
  }, [ticking]);

  return (
    <ActiveRoomContext value={{ room, pathname }}>
      <Suspense fallback={null}>
        <PathnameReporter onChange={changePathname} />
      </Suspense>
      {children}
    </ActiveRoomContext>
  );
}

function PathnameReporter({ onChange }: { onChange: (pathname: string) => void }) {
  const pathname = usePathname();
  useEffect(() => onChange(pathname), [pathname, onChange]);
  return null;
}

export function useActiveRoom() {
  return use(ActiveRoomContext);
}
