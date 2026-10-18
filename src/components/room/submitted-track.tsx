"use client";

import { CheckCircle2, Pause, Play, RefreshCw } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress";
import { useSignedUrl } from "@/hooks/use-signed-url";
import { useTrackPlayer } from "@/hooks/use-track-player";
import { useWaveform } from "@/hooks/use-waveform";
import { formatDuration } from "@/lib/game/audio-file";
import { SUBMISSIONS_BUCKET } from "@/lib/game/storage";
import type { Submission } from "@/lib/game/types";
import { SeekableWaveform } from "./waveform";

export function SubmittedTrack({
  submission,
  file,
  name,
  listenSeconds,
  onReplace,
  replacing,
}: {
  submission: Submission;
  file: File | null;
  name: string | null;
  listenSeconds: number | null | undefined;
  onReplace: (() => void) | null;
  replacing: { name: string; progress: number } | null;
}) {
  const localUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => {
    if (localUrl) URL.revokeObjectURL(localUrl);
  }, [localUrl]);
  const remote = useSignedUrl(SUBMISSIONS_BUCKET, localUrl ? null : submission.storage_path);
  const url = localUrl ?? remote.url;
  const waveform = useWaveform(localUrl ? `local:${submission.id}` : submission.storage_path, url);
  const player = useTrackPlayer(url);
  const durationMs = player.durationMs ?? submission.duration_ms;
  const limitMs = listenSeconds ? listenSeconds * 1000 : null;
  const clipped = limitMs !== null && limitMs < durationMs;

  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-line-strong bg-surface p-5 sm:p-6">
      <div className="flex items-center gap-4">
        <button
          onClick={player.toggle}
          disabled={!url}
          aria-label={player.playing ? "Pause your track" : "Play your track"}
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-fg text-page transition-[transform,opacity] duration-150 ease-snappy hover:bg-white/85 active:scale-[0.97] disabled:opacity-40"
        >
          {player.playing ? <Pause className="h-6 w-6 fill-current" /> : <Play className="ml-0.5 h-6 w-6 fill-current" />}
        </button>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-xs font-semibold tracking-[0.12em] text-muted uppercase">
            <CheckCircle2 className="h-3.5 w-3.5 text-fg" />
            Submitted
          </p>
          <p className="truncate text-lg font-bold sm:text-xl">{name ?? "Your track"}</p>
        </div>
        {onReplace && (
          <Button variant="ghost" size="sm" onClick={onReplace}>
            <RefreshCw className="h-4 w-4" />
            Replace
          </Button>
        )}
      </div>

      <SeekableWaveform
        peaks={waveform.peaks}
        progress={durationMs ? player.timeMs / durationMs : 0}
        clipMs={url ? durationMs : null}
        onSeek={(ms) => player.seek(ms / durationMs)}
        label="Seek your track"
      >
        {clipped && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 w-px bg-fg/50"
            style={{ left: `${(limitMs / durationMs) * 100}%` }}
          />
        )}
      </SeekableWaveform>

      <div className="flex items-center justify-between gap-4 text-xs text-muted tabular-nums">
        <span>
          {formatDuration(player.timeMs)} / {formatDuration(durationMs)}
        </span>
        {clipped && <span>Room plays the first {listenSeconds}s</span>}
      </div>

      {replacing && (
        <div className="flex animate-drop-in flex-col gap-2 border-t border-line pt-4">
          <div className="flex items-center justify-between gap-4 text-xs text-muted">
            <span className="truncate">{replacing.progress >= 1 ? "Checking file…" : `Replacing with ${replacing.name}`}</span>
            {replacing.progress < 1 && <span className="tabular-nums">{Math.round(replacing.progress * 100)}%</span>}
          </div>
          <ProgressBar value={replacing.progress} />
        </div>
      )}

      <audio {...player.audioProps} className="hidden" />
    </div>
  );
}
