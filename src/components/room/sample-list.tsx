"use client";

import { Download, Pause, Play } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { List, ListRow, Thumb } from "@/components/ui/list";
import { ProgressBar } from "@/components/ui/progress";
import { useAudioPreview } from "@/hooks/use-audio-preview";
import { getSignedUrl, useSignedUrl } from "@/hooks/use-signed-url";
import { formatDuration } from "@/lib/game/audio-file";
import { groupSamples, sampleFileName } from "@/lib/game/samples";
import { SAMPLES_BUCKET } from "@/lib/game/storage";
import type { RoomAsset, SampleAsset } from "@/lib/game/types";
import { notifyFailure } from "@/lib/ui/notify";

const DOWNLOAD_GAP_MS = 500;

function withDownload(url: string, fileName: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("download", fileName);
  return parsed.toString();
}

function triggerDownload(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function SampleList({ assets }: { assets: RoomAsset[] }) {
  const groups = groupSamples(assets);
  const preview = useAudioPreview();
  const [downloading, setDownloading] = useState(false);

  async function downloadAll() {
    setDownloading(true);
    let failed = 0;
    for (const sample of groups.flatMap((g) => g.samples)) {
      try {
        triggerDownload(withDownload(await getSignedUrl(SAMPLES_BUCKET, sample.storage_path), sampleFileName(sample)));
        await new Promise((resolve) => setTimeout(resolve, DOWNLOAD_GAP_MS));
      } catch {
        failed++;
      }
    }
    setDownloading(false);
    if (failed) notifyFailure(`${failed} ${failed === 1 ? "sample is" : "samples are"} unavailable right now.`);
  }

  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center">
        <p className="font-semibold">The sample library is empty right now</p>
        <p className="mt-1 text-sm text-muted">No pack this time. Make anything you like and upload it before the timer ends.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Everyone gets the same pack. Flip it however you want.</p>
        <Button variant="outline" size="sm" onClick={downloadAll} loading={downloading}>
          <Download className="h-4 w-4" />
          Download all
        </Button>
      </div>
      {groups.map((group) => (
        <div key={group.category} className="flex flex-col gap-1">
          <Eyebrow className="border-b border-line px-2 pb-2">{group.label}</Eyebrow>
          <List>
            {group.samples.map((sample) => (
              <SampleRow
                key={sample.id}
                sample={sample}
                playing={preview.playingId === String(sample.id)}
                progress={preview.playingId === String(sample.id) ? preview.progress : 0}
                onToggle={(url) => preview.toggle(String(sample.id), url)}
              />
            ))}
          </List>
        </div>
      ))}
    </div>
  );
}

function SampleRow({
  sample,
  playing,
  progress,
  onToggle,
}: {
  sample: SampleAsset;
  playing: boolean;
  progress: number;
  onToggle: (url: string) => void;
}) {
  const { url, error } = useSignedUrl(SAMPLES_BUCKET, sample.storage_path);
  const details = [
    sample.bpm ? `${sample.bpm} BPM` : null,
    sample.musical_key,
    sample.duration_ms ? formatDuration(sample.duration_ms) : null,
  ].filter(Boolean);

  return (
    <ListRow
      className="grid-cols-[minmax(0,1fr)_auto]"
      thumb={
        <button
          onClick={() => url && onToggle(url)}
          disabled={!url}
          aria-label={playing ? `Pause ${sample.name}` : `Preview ${sample.name}`}
          className="shrink-0 disabled:opacity-40"
        >
          <Thumb className={cn("transition hover:bg-hover", playing && "bg-fg text-page hover:bg-white/85")}>
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Thumb>
        </button>
      }
      title={<span className="truncate">{sample.name}</span>}
      subtitle={
        error ? (
          "File unavailable"
        ) : playing ? (
          <ProgressBar value={progress} className="mt-2 w-40" />
        ) : (
          details.join(" · ") || "Sample"
        )
      }
      trailing={
        url ? (
          <a
            href={withDownload(url, sampleFileName(sample))}
            aria-label={`Download ${sample.name}`}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted transition hover:bg-white/[0.06] hover:text-fg"
          >
            <Download className="h-4 w-4" />
          </a>
        ) : (
          <span className="flex h-9 w-9 items-center justify-center text-subtle">
            <Download className="h-4 w-4" />
          </span>
        )
      }
    />
  );
}
