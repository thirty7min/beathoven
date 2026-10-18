"use client";

import { useCallback, useEffect, useState } from "react";
import type { Profile } from "@/components/auth-provider";
import type { RoomMode } from "@/lib/game/types";
import { USERNAME_PATTERN, escapeLike } from "@/lib/profile/validate";
import { getBrowserClient } from "@/lib/supabase/client";

export type RoundHistoryItem = {
  key: string;
  mode: RoomMode;
  rank: number;
  entrants: number;
  avgScore: number | null;
  voteCount: number;
  isWinner: boolean;
  tied: boolean;
  playedAt: string | null;
};

const HISTORY_LIMIT = 10;

// round_results is only readable for rooms the viewer was in, so visitors only see shared battles.
async function fetchHistory(userId: string): Promise<RoundHistoryItem[]> {
  const supabase = getBrowserClient();
  const { data: mine } = await supabase
    .from("round_results")
    .select("room_id, round, submission_id, rank, avg_score, vote_count, is_winner")
    .eq("user_id", userId)
    .limit(200);
  if (!mine?.length) return [];

  const roomIds = [...new Set(mine.map((r) => r.room_id))];
  const [{ data: subs }, { data: rooms }, { data: field }] = await Promise.all([
    supabase.from("submissions").select("id, submitted_at").in("id", mine.map((r) => r.submission_id)),
    supabase.from("rooms").select("id, mode").in("id", roomIds),
    supabase.from("round_results").select("room_id, round, is_winner").in("room_id", roomIds),
  ]);

  const playedAt = new Map((subs ?? []).map((s) => [s.id, s.submitted_at]));
  const modes = new Map((rooms ?? []).map((r) => [r.id, r.mode]));
  const roundKey = (roomId: string, round: number) => `${roomId}:${round}`;
  const entrants = new Map<string, { total: number; winners: number }>();
  for (const row of field ?? []) {
    const k = roundKey(row.room_id, row.round);
    const e = entrants.get(k) ?? { total: 0, winners: 0 };
    e.total++;
    if (row.is_winner) e.winners++;
    entrants.set(k, e);
  }

  return mine
    .map((r) => {
      const e = entrants.get(roundKey(r.room_id, r.round));
      return {
        key: r.submission_id,
        mode: modes.get(r.room_id) ?? "classic",
        rank: r.rank,
        entrants: e?.total ?? 1,
        avgScore: r.avg_score === null ? null : Number(r.avg_score),
        voteCount: r.vote_count,
        isWinner: r.is_winner,
        tied: r.is_winner && (e?.winners ?? 1) > 1,
        playedAt: playedAt.get(r.submission_id) ?? null,
      };
    })
    .sort((a, b) => (b.playedAt ?? "").localeCompare(a.playedAt ?? ""))
    .slice(0, HISTORY_LIMIT);
}

type State =
  | { status: "loading" }
  | { status: "not_found" }
  | { status: "error" }
  | { status: "ready"; profile: Profile; history: RoundHistoryItem[] | null };

export function useProfile(username: string) {
  const [state, setState] = useState<{ username: string; value: State }>({ username, value: { status: "loading" } });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const set = (value: State) => !cancelled && setState({ username, value });
    if (!USERNAME_PATTERN.test(username)) {
      set({ status: "not_found" });
      return;
    }
    void (async () => {
      const { data, error } = await getBrowserClient()
        .from("profiles")
        .select("*")
        .ilike("username", escapeLike(username))
        .limit(1)
        .maybeSingle();
      if (error) return set({ status: "error" });
      if (!data) return set({ status: "not_found" });
      set({ status: "ready", profile: data, history: null });
      const history = await fetchHistory(data.id).catch(() => []);
      set({ status: "ready", profile: data, history });
    })();
    return () => {
      cancelled = true;
    };
  }, [username, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  return { state: state.username === username ? state.value : ({ status: "loading" } as State), reload };
}
