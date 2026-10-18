"use client";

import { Check, VolumeX } from "lucide-react";
import { useSound } from "@/components/sound-provider";
import { Avatar } from "@/components/ui/avatar";
import { HighlightPill } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { useSignedUrl } from "@/hooks/use-signed-url";
import { useSyncedAudio } from "@/hooks/use-synced-audio";
import { useVisualizerPrefs } from "@/hooks/use-visualizer-prefs";
import { useWaveform } from "@/hooks/use-waveform";
import { formatDuration } from "@/lib/game/audio-file";
import { clipMs, currentSubmission, playbackPosition } from "@/lib/game/phase";
import { playbackProgress } from "@/lib/game/playback-sync";
import { isOwnSubmission, revealedProducer } from "@/lib/game/room-extras";
import { SUBMISSIONS_BUCKET } from "@/lib/game/storage";
import { isTransientError } from "@/lib/game/error-kind";
import { sendVoteQuietly, voteState } from "@/lib/game/voting";
import { shouldShowResumePill } from "@/lib/ui/audio-unlock";
import { vignetteGradient } from "@/lib/ui/visualizer";
import { RatingDial } from "./rating-dial";
import { StageCounter, StageHeader } from "./stage";
import type { RoomController } from "./types";
import { useRoomAction } from "./use-room-action";
import { VisualizerCanvas, VisualizerControl } from "./visualizer";
import { Waveform } from "./waveform";

export function ListeningView({ room, serverNow }: { room: RoomController; serverNow: number | null }) {
  const snapshot = room.snapshot!;
  const { room: state, submissions } = snapshot;
  const now = serverNow ?? Date.parse(snapshot.server_time);
  const submission = currentSubmission(state, submissions);
  const playback = playbackPosition(state, submissions, now);
  const nextId = state.current_track !== null ? state.track_order[state.current_track + 1] : undefined;
  const next = submissions.find((s) => s.id === nextId) ?? null;

  const current = useSignedUrl(SUBMISSIONS_BUCKET, submission?.storage_path);
  const upcoming = useSignedUrl(SUBMISSIONS_BUCKET, next?.storage_path);
  const clip = submission ? clipMs(state.listen_seconds, submission) : null;
  const waveform = useWaveform(submission?.storage_path, current.url, clip);
  useWaveform(next?.storage_path, upcoming.url, next ? clipMs(state.listen_seconds, next) : null);
  const audio = useSyncedAudio(playback, current.url);
  const { muted } = useSound();
  const visualizer = useVisualizerPrefs();
  const { pending: action, run } = useRoomAction();
  const isMine = isOwnSubmission(snapshot, submission);
  const vote = voteState({
    submission,
    isMine,
    myVotes: snapshot.my_votes,
    trackStarted: playback.state === "playing" || playback.state === "ended",
    trackEnded: playback.state === "ended",
  });
  const elapsedMs = playback.state === "playing" ? playback.offsetMs : playback.state === "ended" ? (clip ?? 0) : 0;
  const total = state.track_order.length;
  const index = Math.min(state.current_track ?? 0, Math.max(0, total - 1));
  const producer = revealedProducer(snapshot, submission);
  const skip = snapshot.skip?.submission_id === submission?.id ? snapshot.skip : null;

  function onRate(submissionId: string, score: number) {
    void sendVoteQuietly(() => room.actions.castVote(submissionId, score), isTransientError);
  }

  const resumePill = shouldShowResumePill({
    blocked: audio.blocked,
    wantsAudio: playback.state === "playing" || playback.state === "pending",
    muted,
  });
  const status =
    playback.state === "pending"
      ? `Starting in ${Math.ceil(playback.startsInMs / 1000)}`
      : playback.state === "ended"
        ? "Up next"
        : audio.buffering && playback.state === "playing"
          ? "Buffering…"
          : "Now playing";

  return (
    <div className="relative isolate flex min-h-full flex-col">
      {visualizer.on && (
        <div className="absolute inset-0 -z-10 overflow-hidden">
          <VisualizerCanvas
            key={visualizer.style}
            analyser={audio.analyser}
            playing={playback.state === "playing" && !audio.blocked}
            style={visualizer.style}
            reducedMotion={visualizer.reducedMotion}
          />
          <div className="absolute inset-0" style={{ backgroundImage: vignetteGradient() }} />
        </div>
      )}
      <StageHeader title="Listening" aside={total > 0 && <StageCounter label="Entry" value={`${index + 1}/${total}`} />} />

      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center gap-8 px-5 py-6 sm:px-8">
        <div className="flex max-w-full flex-col items-center gap-3 text-center">
          <span className="text-[11px] font-semibold tracking-[0.2em] text-muted uppercase">{status}</span>
          <p className="flex max-w-full items-center gap-4 text-[clamp(2.5rem,8vw,5.5rem)] leading-none font-black tracking-tight">
            {producer ? (
              <>
                <Avatar name={producer.username} url={producer.avatar_url} seed={producer.user_id} size="lg" className="shrink-0" />
                <span className="truncate">{producer.username}</span>
              </>
            ) : (
              `Entry ${index + 1}`
            )}
          </p>
          {isMine && <HighlightPill>Your track</HighlightPill>}
        </div>

        <div className="flex w-full flex-col gap-3">
          <Waveform peaks={waveform.peaks} progress={playbackProgress(playback)} />
          <div className="flex items-center justify-between text-xs text-muted tabular-nums">
            <span>{formatDuration(elapsedMs)}</span>
            <span>{clip !== null ? formatDuration(clip) : "–"}</span>
          </div>
          {current.error && <p className="text-center text-sm text-danger">This track couldn&apos;t be loaded. You can still rate it.</p>}
        </div>

        {submission && (
          <RatingDial key={submission.id} submissionId={submission.id} state={vote} onRate={onRate} />
        )}
      </div>

      <div className="absolute bottom-6 left-5 z-10">
        <VisualizerControl on={visualizer.on} style={visualizer.style} onToggle={visualizer.toggle} onCycle={visualizer.cycle} />
      </div>

      {skip && (
        <div className="fixed right-5 bottom-20 z-10 lg:right-[calc(300px+1.5rem)] lg:bottom-6 xl:right-[calc(320px+1.5rem)]">
          <button
            type="button"
            disabled={isMine || skip.you_voted === true || action === "skip"}
            aria-pressed={skip.you_voted === true}
            onClick={() => run("skip", room.actions.skipTrack)}
            title={isMine ? "You can't skip your own entry" : undefined}
            className={cn(
              "flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-semibold shadow-2xl transition-[transform,background-color,border-color,color] duration-150 ease-snappy active:scale-[0.97] disabled:active:scale-100",
              skip.you_voted ? "border-fg bg-white/[0.12] text-fg" : "border-line-strong bg-surface text-fg hover:border-fg",
              isMine && "opacity-40",
            )}
          >
            Skip
            <span key={skip.you_voted ? "on" : "off"} className="inline-flex animate-swap items-center">
              {skip.you_voted && <Check className="h-3.5 w-3.5" />}
            </span>
            <span className="text-muted tabular-nums">
              {skip.votes}/{skip.needed}
            </span>
          </button>
        </div>
      )}

      {resumePill && (
        <div className="pointer-events-none absolute inset-x-0 top-20 z-10 flex justify-center">
          <p
            role="status"
            className="flex animate-drop-in items-center gap-2 rounded-full border border-line-strong bg-surface/95 px-4 py-2 text-sm shadow-2xl backdrop-blur"
          >
            <VolumeX className="h-4 w-4 text-muted" />
            Sound is paused. Click anywhere to resume.
          </p>
        </div>
      )}

      <audio {...audio.audioProps} className="hidden" />
      {upcoming.url && <audio crossOrigin="anonymous" src={upcoming.url} preload="auto" muted className="hidden" />}
    </div>
  );
}
