"use client";

import { Check, Pause, Play } from "lucide-react";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { useHoverPreview } from "@/hooks/use-hover-preview";
import { usePreviewCard } from "@/hooks/use-preview-card";
import { useSignedUrl } from "@/hooks/use-signed-url";
import { useWaveform } from "@/hooks/use-waveform";
import { isTransientError } from "@/lib/game/error-kind";
import { formatClock } from "@/lib/game/format";
import { phaseCountdown } from "@/lib/game/phase";
import { SUBMISSIONS_BUCKET } from "@/lib/game/storage";
import type { RoomPlayer } from "@/lib/game/types";
import { sendVoteQuietly } from "@/lib/game/voting";
import { displayName } from "@/lib/ui/display-name";
import { reviewProgress, reviewRows, settledOverrides, type ReviewRow } from "@/lib/ui/review";
import { RatingPill, RatingSegments } from "./rating-segments";
import { StageCounter, StageHeader } from "./stage";
import type { RoomController } from "./types";
import { useRoomAction } from "./use-room-action";
import { SeekableWaveform } from "./waveform";

export function ReviewView({ room, serverNow }: { room: RoomController; serverNow: number | null }) {
  const snapshot = room.snapshot!;
  const now = serverNow ?? Date.parse(snapshot.server_time);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const preview = useHoverPreview();
  const { pending, run } = useRoomAction();
  const pendingOverrides = settledOverrides(snapshot, overrides);
  const rows = reviewRows(snapshot, pendingOverrides);
  const progress = reviewProgress(snapshot);
  const countdown = phaseCountdown(snapshot.room, snapshot.submissions, now);
  const remaining = countdown?.label === "review" ? countdown.remainingMs : 0;
  const player = (id: string | null) => (id ? (snapshot.players.find((p) => p.user_id === id) ?? null) : null);

  function rate(submissionId: string, score: number) {
    setOverrides({ ...pendingOverrides, [submissionId]: score });
    void sendVoteQuietly(() => room.actions.castVote(submissionId, score), isTransientError);
  }

  return (
    <div className="flex min-h-full animate-fade-in flex-col">
      <StageHeader title="Review" aside={progress.total > 0 && <StageCounter label="Done" value={`${progress.done}/${progress.total}`} />} />

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-5 pt-4 pb-12 sm:px-8">
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="text-[clamp(3.5rem,12vw,7rem)] leading-none font-black tracking-tighter tabular-nums" role="timer" aria-live="off">
            {formatClock(remaining)}
          </p>
          <p className="text-sm text-muted">Last chance to listen back and change your ratings before results.</p>
        </div>

        <ol className="flex flex-col gap-2">
          {rows.map((row, i) => (
            <ReviewItem
              key={row.submissionId}
              order={i}
              row={row}
              producer={player(row.producerId)}
              listenSeconds={snapshot.room.listen_seconds}
              playing={preview.activeId === row.submissionId}
              blocked={preview.blockedId === row.submissionId}
              progress={preview.activeId === row.submissionId ? preview.progress : 0}
              onEnter={(url, limitMs, startMs) => preview.enter(row.submissionId, url, limitMs, startMs, row.boostDb)}
              onLeave={() => preview.leave(row.submissionId)}
              onTap={(url, limitMs, startMs) => preview.tap(row.submissionId, url, limitMs, startMs, row.boostDb)}
              onSeek={(ms) => preview.seek(row.submissionId, ms)}
              onRate={(score) => rate(row.submissionId, score)}
            />
          ))}
        </ol>

        <div className="sticky bottom-20 z-10 flex flex-col items-center gap-2 lg:bottom-6">
          {progress.meDone ? (
            <p key="waiting" className="flex animate-swap items-center gap-2 rounded-full border border-line-strong bg-surface px-5 py-3 text-sm font-semibold shadow-2xl tabular-nums">
              <Check className="h-4 w-4" />
              Waiting for others · {progress.done}/{progress.total} done
            </p>
          ) : (
            <Button
              key="done"
              variant="primary"
              size="lg"
              className="animate-swap px-10 shadow-2xl"
              loading={pending === "finish-review"}
              onClick={() => run("finish-review", () => room.actions.finishReview())}
            >
              Done
            </Button>
          )}
          {progress.meDone && <p className="text-xs text-muted">You can still change ratings until the timer ends.</p>}
        </div>
      </div>
    </div>
  );
}

function ReviewItem({
  order,
  row,
  producer,
  listenSeconds,
  playing,
  blocked,
  progress,
  onEnter,
  onLeave,
  onTap,
  onSeek,
  onRate,
}: {
  order: number;
  row: ReviewRow;
  producer: RoomPlayer | null;
  listenSeconds: number | null | undefined;
  playing: boolean;
  blocked: boolean;
  progress: number;
  onEnter: (url: string, limitMs: number | null, startMs: number) => void;
  onLeave: () => void;
  onTap: (url: string, limitMs: number | null, startMs: number) => void;
  onSeek: (ms: number) => void;
  onRate: (score: number) => void;
}) {
  const { url, error } = useSignedUrl(SUBMISSIONS_BUCKET, row.storagePath);
  const { peaks } = useWaveform(row.storagePath, url, row.clipMs, row.clipStartMs);
  const name = producer ? displayName(producer) : null;
  const card = usePreviewCard(url, row.clipMs, row.clipStartMs, { enter: onEnter, leave: onLeave, tap: onTap });

  return (
    <li
      {...card}
      style={{ animationDelay: `${Math.min(order, 8) * 40}ms` }}
      className={cn(
        "grid animate-reveal grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 rounded-2xl border p-3 transition-[background-color,border-color] duration-150 ease-snappy sm:grid-cols-[auto_minmax(0,10rem)_minmax(0,1fr)_auto] sm:gap-x-4 sm:p-4",
        playing ? "border-line-strong bg-raised" : "border-line bg-surface hover:border-line-strong",
        row.mine && "opacity-60",
      )}
    >
      <button
        type="button"
        onClick={() => url && onTap(url, row.clipMs, row.clipStartMs)}
        disabled={!url}
        aria-label={playing ? `Pause ${row.label}` : `Play ${row.label}`}
        title={error ? "Track unavailable" : undefined}
        className={cn(
          "flex h-10 w-10 items-center justify-center rounded-full border transition-[transform,background-color,border-color,color] duration-150 ease-snappy active:scale-[0.97] disabled:opacity-30",
          playing ? "border-fg bg-fg text-page" : blocked ? "border-fg text-fg" : "border-line-strong hover:border-fg",
        )}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>
      <span className="flex min-w-0 items-center gap-2.5">
        {producer && <Avatar name={name ?? ""} url={producer.avatar_url} seed={producer.user_id} size="sm" />}
        <span className="flex min-w-0 flex-col">
          <span className="text-[15px] font-semibold">{row.label}</span>
          {name && <span className="truncate text-[13px] text-muted">{name}</span>}
        </span>
      </span>
      <SeekableWaveform
        peaks={peaks}
        progress={progress}
        clipMs={row.clipMs || (listenSeconds ? listenSeconds * 1000 : null)}
        onSeek={playing ? onSeek : null}
        label={`Seek ${row.label}`}
        className="order-last col-span-full sm:order-none sm:col-span-1"
        waveClassName="h-8 sm:h-10"
      />
      <span className="justify-self-end">
        {row.mine ? (
          <RatingPill>Your track</RatingPill>
        ) : (
          <RatingSegments score={row.score} label={`Rating for ${row.label}`} onRate={onRate} />
        )}
      </span>
    </li>
  );
}
