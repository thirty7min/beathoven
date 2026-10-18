"use client";

import { CheckCircle2, Lock, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress";
import { useSignedUrl } from "@/hooks/use-signed-url";
import { useWaveform } from "@/hooks/use-waveform";
import { SUBMISSIONS_BUCKET } from "@/lib/game/storage";
import type { MySubmission } from "@/lib/game/types";
import { storedPeaks } from "@/lib/tracks/peaks";
import { clipLimits, initialClip, sameClip, submissionStatus, type ClipWindow, type SubmissionStatus } from "@/lib/ui/clip-window";
import { notifyError } from "@/lib/ui/notify";
import { objectUrlFor, releaseObjectUrl, retainObjectUrl } from "@/lib/ui/object-url";
import { ClipTrimmer } from "./clip-trimmer";
import { Switch } from "@/components/ui/switch";
import { LOUDNESS_BOOST_ENABLED } from "@/lib/features";
import { playbackBoostDb, waveformBoostScale } from "@/lib/ui/loudness";

const DRAFT_SAVE_DELAY_MS = 600;

const STATUS_LABEL: Record<Exclude<SubmissionStatus, "draft">, string> = {
  submitted: "Submitted",
  edited: "Unsaved changes",
  locked: "Locked in",
};

export function SubmittedTrack({
  submission,
  file,
  name,
  listenSeconds,
  closed,
  onReplace,
  replacing,
  onConfirm,
  onSaveDraft,
}: {
  submission: MySubmission;
  file: File | null;
  name: string | null;
  listenSeconds: number | null | undefined;
  closed: boolean;
  onReplace: (() => void) | null;
  replacing: { name: string; progress: number } | null;
  onConfirm: (clip: ClipWindow, peaks: number[] | null, loudnessBoost: boolean | null) => Promise<unknown>;
  onSaveDraft: (clip: ClipWindow, peaks: number[] | null, loudnessBoost: boolean | null) => Promise<unknown>;
}) {
  const localUrl = useMemo(() => (file ? objectUrlFor(file) : null), [file]);
  useEffect(() => {
    if (!file || !localUrl) return;
    retainObjectUrl(localUrl);
    return () => releaseObjectUrl(file, localUrl);
  }, [file, localUrl]);
  const remote = useSignedUrl(SUBMISSIONS_BUCKET, localUrl ? null : submission.storage_path);
  const url = localUrl ?? remote.url;
  const waveform = useWaveform(localUrl ? `local:${submission.id}:${submission.storage_path}` : submission.storage_path, url);
  const peaksToStore = useMemo(() => (waveform.peaks ? storedPeaks(waveform.peaks) : null), [waveform.peaks]);
  const limits = useMemo(() => clipLimits(submission.duration_ms, listenSeconds), [submission.duration_ms, listenSeconds]);
  const saved = useMemo(
    () => initialClip(limits, { startMs: submission.clip_start_ms, endMs: submission.clip_end_ms }),
    [limits, submission.clip_start_ms, submission.clip_end_ms],
  );
  const [clip, setClip] = useState<ClipWindow>(saved);
  const savedBoost = submission.loudness_boost ?? true;
  const [boost, setBoost] = useState(savedBoost);
  const [confirming, setConfirming] = useState(false);
  const boostDb = playbackBoostDb(submission, boost);
  const boostToSend = LOUDNESS_BOOST_ENABLED ? boost : null;
  const dirty = !sameClip(clip, saved) || boost !== savedBoost;
  const status = submissionStatus({ confirmed: submission.confirmed, dirty, closed });

  useEffect(() => {
    if (submission.confirmed || closed || !dirty) return;
    const timer = window.setTimeout(() => void onSaveDraft(clip, peaksToStore, boostToSend).catch(() => undefined), DRAFT_SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [clip, boostToSend, dirty, closed, submission.confirmed, onSaveDraft, peaksToStore]);

  async function confirm() {
    setConfirming(true);
    try {
      await onConfirm(clip, peaksToStore, boostToSend);
    } catch (error) {
      notifyError(error, "Couldn't submit your clip. Please try again.");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-line-strong bg-surface p-5 sm:p-6">
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          {status !== "draft" && (
            <p key={status} className="flex animate-swap items-center gap-1.5 text-xs font-semibold tracking-[0.12em] text-muted uppercase">
              {status === "locked" ? <Lock className="h-3.5 w-3.5 text-fg" /> : status === "submitted" ? <CheckCircle2 className="h-3.5 w-3.5 text-fg" /> : null}
              {STATUS_LABEL[status]}
            </p>
          )}
          <p className="truncate text-lg font-bold sm:text-xl">{name ?? "Your track"}</p>
        </div>
        {onReplace && !closed && (
          <Button variant="ghost" size="sm" onClick={onReplace}>
            <RefreshCw className="h-4 w-4" />
            Replace
          </Button>
        )}
      </div>

      <ClipTrimmer
        url={url}
        peaks={waveform.peaks}
        limits={limits}
        value={clip}
        onChange={setClip}
        disabled={closed || confirming}
        boostDb={boostDb}
        waveScale={waveformBoostScale(playbackBoostDb(submission, true), boost)}
        aside={
          LOUDNESS_BOOST_ENABLED && (
            <label className="flex items-center gap-2.5 text-sm font-medium">
              Loudness boost
              <Switch checked={boost} onChange={setBoost} label="Loudness boost" disabled={closed || confirming} />
            </label>
          )
        }
      />

      {!closed && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <p className="min-w-0 flex-1 text-sm text-muted tabular-nums">
            {status === "draft"
              ? "If you don't submit, this clip goes in automatically when time's up."
              : status === "edited"
                ? "Update to send your new clip. Otherwise your last submitted clip plays."
                : "You can still adjust the clip or replace the track until time's up."}
          </p>
          <Button variant={status === "submitted" ? "outline" : "primary"} onClick={confirm} loading={confirming} disabled={status === "submitted"}>
            {status === "draft" ? "Submit" : status === "edited" ? "Update clip" : (
              <>
                Submitted <CheckCircle2 className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      )}

      {replacing && (
        <div className="flex animate-drop-in flex-col gap-2 border-t border-line pt-4">
          <div className="flex items-center justify-between gap-4 text-xs text-muted">
            <span className="truncate">{replacing.progress >= 1 ? "Checking file…" : `Replacing with ${replacing.name}`}</span>
            {replacing.progress < 1 && <span className="tabular-nums">{Math.round(replacing.progress * 100)}%</span>}
          </div>
          <ProgressBar value={replacing.progress} />
        </div>
      )}
    </div>
  );
}
