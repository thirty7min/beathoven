"use client";

import { useCallback, useEffect, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import { getMyTracks, getProfileTracks, type MyTrack, type ProfileTrack, type TrackSort } from "@/lib/tracks/api";

type Data = { username: string; tracks: ProfileTrack[]; mine: MyTrack[] | null };
type State = { status: "loading" } | { status: "error" } | { status: "ready"; data: Data };

export function useProfileTracks(username: string, sort: TrackSort, isOwner: boolean) {
  const key = `${username}:${sort}:${isOwner}`;
  const [state, setState] = useState<{ key: string; value: State; last: Data | null }>({ key, value: { status: "loading" }, last: null });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const supabase = getBrowserClient();
    Promise.all([getProfileTracks(supabase, username, { sort }), isOwner ? getMyTracks(supabase) : Promise.resolve(null)]).then(
      ([tracks, mine]) => {
        if (cancelled) return;
        const data = { username, tracks, mine };
        setState({ key, value: { status: "ready", data }, last: data });
      },
      () => !cancelled && setState((prev) => ({ key, value: { status: "error" }, last: prev.last })),
    );
    return () => {
      cancelled = true;
    };
  }, [key, username, sort, isOwner, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  const value: State = state.key === key ? state.value : { status: "loading" };
  return { state: value, previous: state.last?.username === username ? state.last : null, reload };
}
