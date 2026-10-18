"use client";

import { Pause, Play, Trophy } from "lucide-react";
import { useRef } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge, HighlightPill } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { useHoverPreview } from "@/hooks/use-hover-preview";
import { useSignedUrl } from "@/hooks/use-signed-url";
import { useWaveform } from "@/hooks/use-waveform";
import { formatClock, formatScore } from "@/lib/game/format";
import { clipMs } from "@/lib/game/phase";
import { outcome } from "@/lib/game/scoring";
import { SUBMISSIONS_BUCKET } from "@/lib/game/storage";
import type { RoomSnapshot, RoundResult } from "@/lib/game/types";
import { resamplePeaks } from "@/lib/game/waveform";
import { StageCounter, StageHeader } from "./stage";
import { SeekableWaveform } from "./waveform";

const MINI_BARS = 48;

export function ResultsView({ snapshot, serverNow }: { snapshot: RoomSnapshot; serverNow: number | null }) {
  const preview = useHoverPreview();
  const results = [...snapshot.results].sort((a, b) => a.rank - b.rank);
  const result = outcome(results.map((r) => ({ userId: r.user_id, isWinner: r.is_winner })));
  const player = (id: string) => snapshot.players.find((p) => p.user_id === id);
  const name = (id: string) => player(id)?.username ?? "Unknown player";
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
              <div className="flex max-w-full items-center gap-4">
                <Avatar name={name(result.userId)} url={player(result.userId)?.avatar_url} seed={result.userId} size="lg" className="shrink-0" />
                <p className="truncate text-[clamp(2.75rem,9vw,6rem)] leading-none font-black tracking-tight">{name(result.userId)}</p>
              </div>
              <p className="text-sm text-muted">
                {formatScore(winner.avg_score)} average from {winner.vote_count} {winner.vote_count === 1 ? "vote" : "votes"}
                {result.userId === snapshot.me && " · that's you!"}
              </p>
            </>
          ) : result.kind === "tie" ? (
            <>
              <HighlightPill>It&apos;s a tie</HighlightPill>
              <p className="text-[clamp(2.25rem,7vw,4.5rem)] leading-tight font-black tracking-tight text-balance">
                {result.userIds.map(name).join(" & ")}
              </p>
              <p className="text-sm text-muted">Tied on {formatScore(winner?.avg_score ?? null)} average. Everyone on top gets a tie.</p>
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
                onEnter={(url, limitMs) => preview.enter(r.submission_id, url, limitMs)}
                onLeave={() => preview.leave(r.submission_id)}
                onTap={(url, limitMs) => preview.tap(r.submission_id, url, limitMs)}
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
  onEnter: (url: string, limitMs: number | null) => void;
  onLeave: () => void;
  onTap: (url: string, limitMs: number | null) => void;
  onSeek: (ms: number) => void;
}) {
  const pointer = useRef("mouse");
  const player = snapshot.players.find((p) => p.user_id === result.user_id);
  const submission = snapshot.submissions.find((s) => s.id === result.submission_id);
  const { url, error } = useSignedUrl(SUBMISSIONS_BUCKET, submission?.storage_path);
  const clip = submission ? clipMs(snapshot.room.listen_seconds, submission) : null;
  const { peaks } = useWaveform(submission?.storage_path, url, clip);
  const username = player?.username ?? "Unknown player";
  const mine = result.user_id === snapshot.me;

  return (
    <li
      onPointerDown={(e) => {
        pointer.current = e.pointerType;
      }}
      onPointerEnter={(e) => e.pointerType === "mouse" && url && onEnter(url, clip)}
      onPointerLeave={(e) => e.pointerType === "mouse" && onLeave()}
      onClick={(e) => {
        if (pointer.current !== "mouse" && url && !(e.target instanceof Element && e.target.closest("button"))) onTap(url, clip);
      }}
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
        peaks={peaks && resamplePeaks(peaks, MINI_BARS)}
        progress={progress}
        clipMs={clip}
        onSeek={playing ? onSeek : null}
        label={`Seek ${username}'s track`}
        className="order-last col-span-full sm:order-none sm:col-span-1"
        waveClassName="h-8 sm:h-10"
      />
      <span className="flex flex-col items-end">
        <span className="text-2xl leading-none font-bold tabular-nums">{formatScore(result.avg_score)}</span>
        <span className="mt-1 text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">Avg</span>
      </span>
      <button
        onClick={() => url && onTap(url, clip)}
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
