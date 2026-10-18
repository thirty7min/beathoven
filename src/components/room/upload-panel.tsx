"use client";

import { FileAudio, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { cn } from "@/components/ui/cn";
import { ProgressBar } from "@/components/ui/progress";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { AUDIO_ACCEPT, MAX_SUBMISSION_BYTES, MAX_TRACK_MS, MIN_TRACK_MS, formatBytes, validateAudioFile, validateDuration } from "@/lib/game/audio-file";
import { formatClock } from "@/lib/game/format";
import { readAudioDuration } from "@/lib/game/storage";
import type { MySubmission } from "@/lib/game/types";
import type { ClipWindow } from "@/lib/ui/clip-window";
import { SubmittedTrack } from "./submitted-track";
import type { RoomController } from "./types";
import { notifyError } from "@/lib/ui/notify";

type Upload = { name: string; progress: number };

export function UploadPanel({
  room,
  mySubmission,
  closesInMs,
  lastCall,
  closed,
}: {
  room: RoomController;
  mySubmission: MySubmission | null;
  closesInMs: number | null;
  lastCall: boolean;
  closed: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const [upload, setUpload] = useState<Upload | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [submittedFile, setSubmittedFile] = useState<File | null>(null);
  const busy = upload !== null || reading;
  const { confirmSubmission, setSubmissionClip } = room.actions;
  const confirmClip = useCallback(async (clip: ClipWindow, peaks: number[] | null, loudnessBoost: boolean | null) => {
    const result = await confirmSubmission(clip.startMs, clip.endMs, peaks, loudnessBoost);
    toast.success("Clip submitted");
    return result;
  }, [confirmSubmission]);
  const saveDraft = useCallback(
    (clip: ClipWindow, peaks: number[] | null, loudnessBoost: boolean | null) => setSubmissionClip(clip.startMs, clip.endMs, peaks, loudnessBoost),
    [setSubmissionClip],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function send(file: File | undefined) {
    if (!file || busy || closed) return;
    setError(null);
    const invalid = validateAudioFile(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    setReading(true);
    let durationMs: number;
    try {
      durationMs = await readAudioDuration(file);
    } catch {
      setReading(false);
      setError("Couldn't read that file. Try exporting it as MP3 or WAV.");
      return;
    }
    setReading(false);
    const badDuration = validateDuration(durationMs);
    if (badDuration) {
      setError(badDuration);
      return;
    }

    const replacing = mySubmission !== null;
    setUpload({ name: file.name, progress: 0 });
    try {
      await room.actions.submitTrack(file, durationMs, (progress) => mounted.current && setUpload({ name: file.name, progress }));
      if (!mounted.current) return;
      setSubmittedFile(file);
      toast.success(replacing ? "Track replaced. Pick your clip and submit again." : "Uploaded. Pick your clip and submit.");
    } catch (e) {
      if (!mounted.current) {
        toast(replacing ? "Listening started, your previous upload was kept" : "Listening started before your upload finished");
        return;
      }
      notifyError(e, replacing ? "Replace failed. Your previous upload is still in." : "Upload failed. Please try again.");
    } finally {
      if (mounted.current) setUpload(null);
    }
  }

  const dropProps = {
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      if (!closed) setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      void send(e.dataTransfer.files[0]);
    },
  };

  const picker = (
    <input
      ref={inputRef}
      type="file"
      accept={AUDIO_ACCEPT}
      className="hidden"
      onChange={(e) => {
        void send(e.target.files?.[0]);
        e.target.value = "";
      }}
    />
  );

  if (mySubmission) {
    return (
      <div {...dropProps} className={cn("flex flex-col gap-2 rounded-2xl transition-[box-shadow] duration-150", dragging && "ring-2 ring-fg/60")}>
        <SubmittedTrack
          key={`${mySubmission.id}:${mySubmission.storage_path}`}
          submission={mySubmission}
          file={submittedFile}
          name={submittedFile?.name ?? null}
          listenSeconds={room.snapshot?.room.listen_seconds}
          closed={closed}
          onReplace={closed || busy ? null : () => inputRef.current?.click()}
          replacing={upload}
          onConfirm={confirmClip}
          onSaveDraft={saveDraft}
        />
        {error && <p className="text-sm text-danger">{error}</p>}
        {picker}
      </div>
    );
  }

  if (closed) {
    return (
      <div className="rounded-xl border border-line px-6 py-8 text-center">
        <p className="font-semibold">Uploads are closed</p>
        <p className="mt-1 text-sm text-muted">You didn&apos;t submit this round. Stick around to listen and vote.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {upload ? (
        <div className="flex animate-fade-in flex-col gap-4 rounded-2xl border border-line-strong bg-surface p-5">
          <div className="flex items-center gap-3.5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-raised">
              <FileAudio className="h-5 w-5 stroke-[1.5]" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold">{upload.name}</p>
              <ShimmerText className="block w-fit text-[13px]">{upload.progress >= 1 ? "Checking file" : "Uploading"}</ShimmerText>
            </div>
            {upload.progress < 1 && <span className="text-xs text-muted tabular-nums">{Math.round(upload.progress * 100)}%</span>}
          </div>
          <ProgressBar value={upload.progress} />
        </div>
      ) : (
        <button
          type="button"
          {...dropProps}
          onClick={() => inputRef.current?.click()}
          disabled={reading}
          className={cn(
            "flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-6 py-12 text-center transition-[background-color,border-color,transform] duration-150 ease-snappy active:scale-[0.99]",
            dragging ? "border-fg bg-white/[0.06]" : "border-line-strong bg-surface hover:bg-raised",
          )}
        >
          <Plus className="h-6 w-6 stroke-[1.5] text-muted" />
          {reading ? (
            <ShimmerText className="text-[15px] font-semibold">Reading file</ShimmerText>
          ) : (
            <span className="text-[15px] font-semibold">Upload or drop your track</span>
          )}
          <span className="text-[13px] text-muted">
            MP3, WAV, FLAC, OGG/Opus or M4A/AAC · up to {formatBytes(MAX_SUBMISSION_BYTES)} · {MIN_TRACK_MS / 1000} s to {MAX_TRACK_MS / 60_000} min
          </span>
        </button>
      )}
      {lastCall && closesInMs !== null && !upload && (
        <p className="text-center text-sm text-muted tabular-nums">Upload closes in {formatClock(closesInMs)}</p>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
      {picker}
    </div>
  );
}
