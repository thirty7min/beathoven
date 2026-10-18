"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Profile } from "@/components/auth-provider";
import { EmptyState } from "@/components/home/lobby-list";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/components/ui/cn";
import { ListRow, ListTable, ListTableSkeleton } from "@/components/ui/list";
import { SkeletonAvatar, SkeletonText } from "@/components/ui/skeleton";
import { Tabs } from "@/components/ui/tabs";
import { getBrowserClient } from "@/lib/supabase/client";
import type { ListColumn } from "@/lib/ui/list-columns";
import { displayName } from "@/lib/ui/display-name";

type Sort = "wins" | "games_played";
type Row = Pick<Profile, "id" | "username" | "display_name" | "avatar_url" | "wins" | "ties" | "games_played">;

const COLUMNS: ListColumn[] = [
  { label: "Producer", width: "minmax(0,1fr)" },
  { label: "Wins", width: "3.5rem", smWidth: "5rem", align: "end" },
  { label: "Ties", width: "5rem", align: "end", fromSm: true },
  { label: "Battles", width: "3.5rem", smWidth: "5rem", align: "end" },
];

export function LeaderboardScreen() {
  const [sort, setSort] = useState<Sort>("wins");
  const [data, setData] = useState<{ sort: Sort; rows: Row[] | null; error: boolean }>({ sort: "wins", rows: null, error: false });

  useEffect(() => {
    let cancelled = false;
    const secondary = sort === "wins" ? "games_played" : "wins";
    void getBrowserClient()
      .from("profiles")
      .select("id, username, display_name, avatar_url, wins, ties, games_played")
      .gt("games_played", 0)
      .order(sort, { ascending: false })
      .order(secondary, { ascending: false })
      .limit(50)
      .then(({ data: rows, error }) => {
        if (!cancelled) setData({ sort, rows: rows ?? null, error: Boolean(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [sort]);

  const rows = data.rows;
  const stale = data.sort !== sort;

  return (
    <div className="flex flex-col gap-6">
      <Tabs
        label="Sort leaderboard"
        items={[
          { id: "wins", label: "Most wins" },
          { id: "games_played", label: "Most battles" },
        ]}
        active={sort}
        onChange={setSort}
      />
      {rows === null ? (
        data.error ? (
          <EmptyState>Couldn&apos;t load the leaderboard.</EmptyState>
        ) : (
          <ListTableSkeleton
            columns={COLUMNS}
            rows={8}
            label="Loading the leaderboard"
            thumb={
              <>
                <span className="w-6 shrink-0 text-sm">
                  <SkeletonText className="ml-auto w-3" />
                </span>
                <SkeletonAvatar size="lg" />
              </>
            }
            subtitle={<SkeletonText className="w-16" />}
            cellWidths={["w-5", "w-5", "w-5"]}
          />
        )
      ) : rows.length === 0 ? (
        <EmptyState>No battles finished yet. Be the first on the board.</EmptyState>
      ) : (
        <ListTable columns={COLUMNS} className={cn("transition-opacity duration-150 ease-snappy", stale && "opacity-60")}>
            {rows.map((row, i) => (
              <ListRow
                key={row.id}
                thumb={
                  <>
                    <span className="w-6 shrink-0 text-right text-sm font-semibold text-muted tabular-nums">{i + 1}</span>
                    <Avatar name={displayName(row)} url={row.avatar_url} seed={row.id} size="lg" />
                  </>
                }
                title={
                  <Link href={`/u/${row.username}`} className="truncate hover:underline">
                    {displayName(row)}
                  </Link>
                }
                subtitle={`${row.games_played} ${row.games_played === 1 ? "battle" : "battles"}`}
                cells={[
                  <span key="w" className="font-semibold">{row.wins}</span>,
                  <span key="t" className="text-muted">{row.ties}</span>,
                  row.games_played,
                ]}
              />
            ))}
        </ListTable>
      )}
    </div>
  );
}
