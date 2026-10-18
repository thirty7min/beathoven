"use client";

import { Pause, Play, Trophy } from "lucide-react";
import { Fragment } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge, HighlightPill } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { useHoverPreview } from "@/hooks/use-hover-preview";
import { usePreviewCard } from "@/hooks/use-preview-card";
import { useSignedUrl } from "@/hooks/use-signed-url";
import { useWaveform } from "@/hooks/use-waveform";
import { formatClock } from "@/lib/game/format";
import { clipMs, clipStartMs } from "@/lib/game/phase";
import { outcome } from "@/lib/game/scoring";
import { SUBMISSIONS_BUCKET } from "@/lib/game/storage";
import type { RoomSnapshot, RoundResult } from "@/lib/game/types";
import { fitFontSize } from "@/lib/ui/headline";
import { pointsLabel, totalPoints } from "@/lib/ui/points";
import { StageCounter, StageHeader } from "./stage";
import { SeekableWaveform } from "./waveform";
import { displayName } from "@/lib/ui/display-name";
import { playbackBoostDb } from "@/lib/ui/loudness";

export function ResultsView({ snapshot, serverNow }: { snapshot: RoomSnapshot; serverNow: number | null }) {
  const preview = useHoverPreview();
  const results = [...snapshot.results].sort((a, b) => a.rank - b.rank);
  const result = outcome(results.map((r) => ({ userId: r.user_id, isWinner: r.is_winner })));
  const player = (id: string) => snapshot.players.find((p) => p.user_id === id);
  const name = (id: string) => displayName(player(id));
  const winner = results.find((r) => r.is_winner);
  const now = serverNow ?? Date.parse(snapshot.server_time);
  const lobbyAt = snapshot.room.phase_ends_at ? Date.parse(snapshot.room.phase_ends_at) : null;

  return (
    <div className="flex min-h-full flex-col">
      <StageHeader title="Results" aside={lobbyAt !== null && <StageCounter label="Lobby in" value={formatClock(lobbyAt - now)} />} />

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-5 pt-8 pb-12 sm:px-8">
        <div className="flex animate-reveal flex-col items-center gap-5 py-6 text-center">
          <Trophy className="h-12 w-12 stroke-[1.25]" />
          {result.kind === "winner" && winner ? (
            <>
              <HighlightPill>Winner</HighlightPill>
              <div className="@container flex w-full justify-center">
                <p
                  className="flex max-w-full min-w-0 items-center gap-[0.2em] leading-tight font-black tracking-tight"
                  style={{ fontSize: fitFontSize([name(result.userId)], { minRem: 1.875, maxRem: 6, capCqi: 14, share: 0.96, singleLine: true, extraEm: 1.2 }) }}
                >
                  <Avatar name={name(result.userId)} url={player(result.userId)?.avatar_url} seed={result.userId} size="fluid" className="size-[0.8em] min-h-12 min-w-12 animate-pop" />
                  <span className="min-w-0 flex-1 truncate" title={name(result.userId)}>
                    {name(result.userId)}
                  </span>
                </p>
              </div>
              <p className="text-sm text-muted">
                {pointsLabel(totalPoints(winner.avg_score, winner.vote_count))} from {winner.vote_count} {winner.vote_count === 1 ? "vote" : "votes"}
                {result.userId === snapshot.me && " · that's you!"}
              </p>
            </>
          ) : result.kind === "tie" ? (
            <>
              <HighlightPill>It&apos;s a tie</HighlightPill>
              <div className="@container w-full">
                <p
                  className="leading-tight font-black tracking-tight text-balance"
                  style={{ fontSize: fitFontSize(result.userIds.map(name), { minRem: 1.5, maxRem: result.userIds.length > 2 ? 3.25 : 4.5, capCqi: result.userIds.length > 2 ? 8 : 11 }) }}
                >
                  {result.userIds.map((id, i) => (
                    <Fragment key={id}>
                      {i > 0 && (i === result.userIds.length - 1 ? " & " : ", ")}
                      <span className="[overflow-wrap:anywhere]">{name(id)}</span>
                    </Fragment>
                  ))}
                </p>
              </div>
              <p className="text-sm text-muted">Tied on {pointsLabel(winner ? totalPoints(winner.avg_score, winner.vote_count) : null)}. Everyone on top gets a tie.</p>
            </>
          ) : (
            <>
              <p className="text-4xl font-black tracking-tight">{results.length ? "No votes this time" : "No tracks this time"}</p>
              <p className="text-sm text-muted">{results.length ? "Nobody rated in time, so there's no winner." : "Nobody submitted before the deadline."}</p>
            </>
          )}
        </div>

        {results.length > 0 && (
          <ol className="flex flex-col gap-2" aria-label="Ranking">
            {results.map((r, i) => (
              <ContestantCard
                key={r.submission_id}
                order={i}
                result={r}
                snapshot={snapshot}
                playing={preview.activeId === r.submission_id}
                blocked={preview.blockedId === r.submission_id}
                progress={preview.activeId === r.submission_id ? preview.progress : 0}
                onEnter={(url, limitMs, startMs) => preview.enter(r.submission_id, url, limitMs, startMs, playbackBoostDb(r))}
                onLeave={() => preview.leave(r.submission_id)}
                onTap={(url, limitMs, startMs) => preview.tap(r.submission_id, url, limitMs, startMs, playbackBoostDb(r))}
                onSeek={(ms) => preview.seek(r.submission_id, ms)}
              />
            ))}
          </ol>
        )}

        <p className="text-center text-sm text-muted">Back in the lobby soon. Ready up there for a rematch.</p>
      </div>
    </div>
  );
}

function ContestantCard({
  order,
  result,
  snapshot,
  playing,
  blocked,
  progress,
  onEnter,
  onLeave,
  onTap,
  onSeek,
}: {
  order: number;
  result: RoundResult;
  snapshot: RoomSnapshot;
  playing: boolean;
  blocked: boolean;
  progress: number;
  onEnter: (url: string, limitMs: number | null, startMs: number) => void;
  onLeave: () => void;
  onTap: (url: string, limitMs: number | null, startMs: number) => void;
  onSeek: (ms: number) => void;
}) {
  const player = snapshot.players.find((p) => p.user_id === result.user_id);
  const submission = snapshot.submissions.find((s) => s.id === result.submission_id);
  const { url, error } = useSignedUrl(SUBMISSIONS_BUCKET, submission?.storage_path);
  const clip = submission ? clipMs(snapshot.room.listen_seconds, submission) : null;
  const start = submission ? clipStartMs(submission) : 0;
  const { peaks } = useWaveform(submission?.storage_path, url, clip, start);
  const username = displayName(player);
  const mine = result.user_id === snapshot.me;
  const card = usePreviewCard(url, clip, start, { enter: onEnter, leave: onLeave, tap: onTap });

  return (
    <li
      {...card}
      style={{ animationDelay: `${200 + Math.min(order, 8) * 50}ms` }}
      className={cn(
        "grid animate-reveal grid-cols-[2rem_minmax(0,1fr)_auto_auto] items-center gap-x-4 gap-y-3 rounded-2xl border p-3 transition-[background-color,border-color] duration-150 ease-snappy sm:grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,11rem)_auto_auto] sm:p-4",
        playing ? "border-line-strong bg-raised" : result.is_winner ? "border-fg/30 bg-white/[0.04]" : "border-line bg-surface hover:border-line-strong",
      )}
    >
      <span className={cn("text-center text-xl font-bold tabular-nums", result.rank > 3 && "text-muted")}>{result.rank}</span>
      <span className="flex min-w-0 items-center gap-3.5">
        <Avatar name={username} url={player?.avatar_url} seed={result.user_id} size="lg" />
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-2 text-[15px] font-semibold">
            <span className="truncate">{username}</span>
            {mine && <Badge tone="outline">You</Badge>}
            {result.is_winner && <Badge tone="solid">Winner</Badge>}
          </span>
          <span className="text-[13px] text-muted tabular-nums">
            {result.vote_count} {result.vote_count === 1 ? "vote" : "votes"}
          </span>
        </span>
      </span>
      <SeekableWaveform
        peaks={peaks}
        progress={progress}
        clipMs={clip}
        onSeek={playing ? onSeek : null}
        label={`Seek ${username}'s track`}
        className="order-last col-span-full sm:order-none sm:col-span-1"
        waveClassName="h-8 sm:h-10"
      />
      <span className="flex flex-col items-end">
        <span className="text-2xl leading-none font-bold tabular-nums">{totalPoints(result.avg_score, result.vote_count) ?? "–"}</span>
        <span className="mt-1 text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">Pts</span>
      </span>
      <button
        onClick={() => url && onTap(url, clip, start)}
        disabled={!url}
        aria-label={playing ? `Pause ${username}'s track` : `Play ${username}'s track`}
        title={error ? "Track unavailable" : undefined}
        className={cn(
          "flex h-10 w-10 items-center justify-center rounded-full border transition-[transform,background-color,border-color,color] duration-150 ease-snappy active:scale-[0.97] disabled:opacity-30",
          playing ? "border-fg bg-fg text-page" : blocked ? "border-fg text-fg" : "border-line-strong hover:border-fg",
        )}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>
    </li>
  );
}
