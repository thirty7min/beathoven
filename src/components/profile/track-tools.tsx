"use client";

import { Check, Split } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { formatDuration } from "@/lib/game/audio-file";
import { modeName } from "@/lib/game/room-settings";
import { getBrowserClient } from "@/lib/supabase/client";
import { mergeTracks, renameTrack, splitSubmission, type MyTrack } from "@/lib/tracks/api";
import { notifyError } from "@/lib/ui/notify";
import { canSplit, mergeTargets } from "@/lib/ui/tracks";

export type TrackTool = { kind: "rename" | "merge" | "split"; track: MyTrack };

const TITLE_MAX = 80;

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

export function TrackToolDialog({ tool, tracks, onClose, onChanged }: { tool: TrackTool | null; tracks: MyTrack[]; onClose: () => void; onChanged: () => void }) {
  const track = tool ? (tracks.find((t) => t.id === tool.track.id) ?? tool.track) : null;
  const title = tool && track ? { rename: "Rename track", merge: `Merge “${track.title}”`, split: `Uploads of “${track.title}”` }[tool.kind] : undefined;
  return (
    <Dialog open={tool !== null} onClose={onClose} title={title} className="max-h-[92dvh] max-w-lg overflow-y-auto">
      {tool?.kind === "rename" && track && <RenameForm key={track.id} track={track} onClose={onClose} onChanged={onChanged} />}
      {tool?.kind === "merge" && track && <MergeForm key={track.id} track={track} tracks={tracks} onClose={onClose} onChanged={onChanged} />}
      {tool?.kind === "split" && track && <SplitList key={track.id} track={track} onChanged={onChanged} />}
    </Dialog>
  );
}

function RenameForm({ track, onClose, onChanged }: { track: MyTrack; onClose: () => void; onChanged: () => void }) {
  const [title, setTitle] = useState(track.title);
  const [busy, setBusy] = useState(false);
  const trimmed = title.trim();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!trimmed || trimmed === track.title) return onClose();
    setBusy(true);
    try {
      await renameTrack(getBrowserClient(), track.id, trimmed);
      onChanged();
      onClose();
    } catch (error) {
      notifyError(error, "Couldn't rename this track.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <Field label="Title" hint={`${trimmed.length}/${TITLE_MAX}`}>
        <Input value={title} maxLength={TITLE_MAX} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={busy} disabled={!trimmed}>
          Save
        </Button>
      </div>
    </form>
  );
}

function MergeForm({ track, tracks, onClose, onChanged }: { track: MyTrack; tracks: MyTrack[]; onClose: () => void; onChanged: () => void }) {
  const targets = mergeTargets(tracks, track.id);
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function merge() {
    if (!target) return;
    setBusy(true);
    try {
      await mergeTracks(getBrowserClient(), target, track.id);
      onChanged();
      onClose();
    } catch (error) {
      notifyError(error, "Couldn't merge these tracks.");
    } finally {
      setBusy(false);
    }
  }

  if (!targets.length) return <p className="text-sm text-muted">You don&apos;t have another track to merge this into yet.</p>;
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">Pick the track this is the same as. Its uploads and stats move over, and the track you pick keeps its title.</p>
      <ul role="radiogroup" aria-label="Merge into" className="flex max-h-72 flex-col gap-1 overflow-y-auto scrollbar-thin">
        {targets.map((t) => {
          const selected = t.id === target;
          return (
            <li key={t.id}>
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setTarget(t.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors duration-150 ease-snappy",
                  selected ? "border-fg bg-white/[0.06]" : "border-line hover:border-line-strong",
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-semibold">{t.title}</span>
                  <span className="text-xs text-muted">
                    {t.submissions.length} {t.submissions.length === 1 ? "upload" : "uploads"}
                  </span>
                </span>
                <Check className={cn("h-4 w-4 shrink-0 transition-opacity duration-150", selected ? "opacity-100" : "opacity-0")} />
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" onClick={merge} loading={busy} disabled={!target}>
          Merge
        </Button>
      </div>
    </div>
  );
}

function SplitList({ track, onChanged }: { track: MyTrack; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const splittable = canSplit(track);

  async function split(submissionId: string) {
    setBusy(submissionId);
    try {
      await splitSubmission(getBrowserClient(), submissionId);
      onChanged();
    } catch (error) {
      notifyError(error, "Couldn't split off that upload.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        {splittable ? "If an upload isn't really this track, split it off into its own." : "This track only has one upload, so there's nothing to split off."}
      </p>
      <ul className="divide-y divide-line">
        {track.submissions.map((s) => (
          <li key={s.id} className="flex items-center gap-3 py-3">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-semibold">{formatDate(s.submitted_at)}</span>
              <span className="text-xs text-muted">
                {modeName(s.mode)} · {formatDuration(s.duration_ms)}
                {s.match_source === "fingerprint" && " · matched by sound"}
                {!s.finished && " · unfinished"}
              </span>
            </span>
            {splittable && (
              <Button variant="outline" size="sm" onClick={() => split(s.id)} loading={busy === s.id} disabled={busy !== null && busy !== s.id}>
                <Split className="h-4 w-4" />
                Split off
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
