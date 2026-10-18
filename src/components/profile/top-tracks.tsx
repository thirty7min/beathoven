"use client";

import { GitMerge, Pause, Pencil, Play, Split } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EmptyState, LobbyListSkeleton } from "@/components/home/lobby-list";
import { SeekableWaveform } from "@/components/room/waveform";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Eyebrow } from "@/components/ui/card";
import { KebabMenu } from "@/components/ui/kebab-menu";
import { ListRow, ListTable } from "@/components/ui/list";
import { Spinner } from "@/components/ui/spinner";
import { Select } from "@/components/ui/select";
import { useHoverPreview } from "@/hooks/use-hover-preview";
import { useProfileTracks } from "@/hooks/use-profile-tracks";
import { useWaveform } from "@/hooks/use-waveform";
import { formatScore } from "@/lib/game/format";
import { getBrowserClient } from "@/lib/supabase/client";
import { TRACK_SORTS, confirmTrackSuggestion, dismissTrackSuggestion, getTrackStreamUrl, type MyTrack, type ProfileTrack, type TrackSort, type TrackStream } from "@/lib/tracks/api";
import { readStoredPeaks } from "@/lib/tracks/peaks";
import type { ListColumn } from "@/lib/ui/list-columns";
import { playbackBoostDb } from "@/lib/ui/loudness";
import { notifyError } from "@/lib/ui/notify";
import { TRACK_SORT_LABELS, canSplit, formatWinRate, mergeTargets, ordinal, streamUsable, suggestionViews, trackTimeLabel, type SuggestionView } from "@/lib/ui/tracks";
import { TrackToolDialog, type TrackTool } from "./track-tools";

const COLUMNS: ListColumn[] = [
  { label: "Track", width: "minmax(0,1fr)" },
  { label: "Plays", width: "4rem", align: "end", fromSm: true },
  { label: "Wins", width: "3rem", smWidth: "4rem", align: "end" },
  { label: "Win rate", width: "4rem", smWidth: "5rem", align: "end" },
  { label: "Avg", width: "4rem", align: "end", fromSm: true },
  { label: "Best", width: "4rem", align: "end", fromSm: true },
];

const OWNER_COLUMNS: ListColumn[] = [...COLUMNS, { width: "2rem" }];

const SORT_OPTIONS = TRACK_SORTS.map((value) => ({ value, label: TRACK_SORT_LABELS[value] }));

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

export function TopTracks({ username, isOwner, visible = true }: { username: string; isOwner: boolean; visible?: boolean }) {
  const [sort, setSort] = useState<TrackSort>("wins");
  const [tool, setTool] = useState<TrackTool | null>(null);
  const { state, previous, reload } = useProfileTracks(username, sort, isOwner);
  const data = state.status === "ready" ? state.data : previous;
  const mine = data?.mine ?? [];
  const suggestions = isOwner ? suggestionViews(mine) : [];
  const player = useTrackPlayer(visible);

  if (!data) {
    if (state.status === "error") return <EmptyState>Couldn&apos;t load tracks. Check your connection and try again.</EmptyState>;
    return <LobbyListSkeleton rows={3} />;
  }

  return (
    <div className="flex flex-col gap-5">
      {suggestions.length > 0 && <Suggestions items={suggestions} onChanged={reload} />}
      {data.tracks.length === 0 ? (
        <EmptyState>
          {isOwner ? "No finished battles yet. Tracks you battle with will show up here with their stats." : `${username} hasn't finished a battle with a track yet.`}
        </EmptyState>
      ) : (
        <>
          <div className="flex items-center justify-end gap-3">
            <span className="text-xs text-muted">Sort by</span>
            <Select label="Sort tracks" value={sort} options={SORT_OPTIONS} onChange={setSort} />
          </div>
          <ListTable columns={isOwner ? OWNER_COLUMNS : COLUMNS} className={state.status === "loading" ? "opacity-60 transition-opacity" : "transition-opacity"}>
            {data.tracks.map((track) => (
              <TrackRow
                key={track.id}
                track={track}
                owned={isOwner ? mine.find((t) => t.id === track.id) : undefined}
                mine={mine}
                isOwner={isOwner}
                onTool={setTool}
                url={player.urls[track.id] ?? null}
                playing={player.activeId === track.id}
                loading={player.loadingId === track.id}
                blocked={player.blockedId === track.id}
                progress={player.activeId === track.id ? player.progress : null}
                onToggle={() => void player.toggle(track.id)}
                onSeek={(ms) => player.seek(track.id, ms)}
              />
            ))}
          </ListTable>
        </>
      )}
      {isOwner && <TrackToolDialog tool={tool} tracks={mine} onClose={() => setTool(null)} onChanged={reload} />}
    </div>
  );
}

function streamBoostDb(stream: TrackStream) {
  return playbackBoostDb({ loudness_lufs: stream.loudnessLufs, true_peak_dbtp: stream.truePeakDbtp, loudness_boost: stream.loudnessBoost });
}

function useTrackPlayer(visible: boolean) {
  const preview = useHoverPreview();
  const streams = useRef(new Map<string, TrackStream>());
  const request = useRef(0);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const { activeId, tap } = preview;

  useEffect(() => {
    if (visible || !activeId) return;
    request.current++;
    tap(activeId, "");
  }, [visible, activeId, tap]);

  async function toggle(trackId: string) {
    const token = ++request.current;
    const cached = streams.current.get(trackId);
    if (preview.activeId === trackId || (cached && streamUsable(cached.expiresAt, Date.now()))) {
      setLoadingId(null);
      preview.tap(trackId, cached?.url ?? urls[trackId], null, 0, cached ? streamBoostDb(cached) : 0);
      return;
    }
    setLoadingId(trackId);
    try {
      const stream = await getTrackStreamUrl(trackId);
      if (token !== request.current) return;
      streams.current.set(trackId, stream);
      setUrls((prev) => ({ ...prev, [trackId]: stream.url }));
      preview.tap(trackId, stream.url, null, 0, streamBoostDb(stream));
    } catch (error) {
      if (token === request.current) notifyError(error, "Couldn't play that track.");
    } finally {
      if (token === request.current) setLoadingId(null);
    }
  }

  return {
    activeId: preview.activeId,
    blockedId: preview.blockedId,
    progress: preview.progress,
    loadingId,
    urls,
    toggle,
    seek: preview.seek,
  };
}

function TrackRow({
  track,
  owned,
  mine,
  isOwner,
  onTool,
  url,
  playing,
  loading,
  blocked,
  progress,
  onToggle,
  onSeek,
}: {
  track: ProfileTrack;
  owned: MyTrack | undefined;
  mine: MyTrack[];
  isOwner: boolean;
  onTool: (tool: TrackTool) => void;
  url: string | null;
  playing: boolean;
  loading: boolean;
  blocked: boolean;
  progress: number | null;
  onToggle: () => void;
  onSeek: (ms: number) => void;
}) {
  const stored = readStoredPeaks(track.peaks);
  const decoded = useWaveform(stored ? null : `track:${track.id}`, stored ? null : url);
  const peaks = stored ?? decoded.peaks;
  const time = trackTimeLabel(track.duration_ms, progress);

  return (
    <ListRow
      thumb={
        <button
          type="button"
          onClick={onToggle}
          disabled={!track.playable}
          aria-label={playing ? `Pause ${track.title}` : `Play ${track.title}`}
          title={track.playable ? undefined : "Not available to play"}
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-[transform,background-color,border-color,color] duration-150 ease-snappy active:scale-[0.97] disabled:opacity-30",
            playing ? "border-fg bg-fg text-page" : blocked ? "border-fg text-fg" : "border-line-strong hover:border-fg",
          )}
        >
          {loading ? <Spinner className="h-4 w-4" /> : playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
      }
      title={<span className="truncate">{track.title}</span>}
      subtitle={
        <span className="mt-1 flex min-w-0 items-center gap-3">
          <SeekableWaveform
            peaks={peaks}
            progress={progress ?? 0}
            clipMs={track.duration_ms}
            onSeek={playing ? onSeek : null}
            label={`Seek ${track.title}`}
            className={cn("w-40 shrink-0 sm:w-64", !track.playable && "opacity-40")}
            waveClassName="h-6"
          />
          {time && <span className="shrink-0 tabular-nums">{time}</span>}
          <span className="hidden truncate sm:inline">last played {formatDate(track.last_played_at)}</span>
        </span>
      }
      cells={[
        <span key="p" className="text-muted">{track.plays}</span>,
        <span key="w" className="font-semibold">{track.wins}</span>,
        formatWinRate(track.win_rate),
        formatScore(track.avg_rating),
        <span key="b" className="text-muted">{ordinal(track.best_finish)}</span>,
      ]}
      trailing={
        isOwner &&
        (owned ? (
          <KebabMenu
            label={`Manage ${track.title}`}
            items={[
              { label: "Rename", icon: <Pencil />, onSelect: () => onTool({ kind: "rename", track: owned }) },
              { label: "Merge into…", icon: <GitMerge />, disabled: mergeTargets(mine, owned.id).length === 0, onSelect: () => onTool({ kind: "merge", track: owned }) },
              { label: canSplit(owned) ? "Split uploads…" : "View uploads", icon: <Split />, onSelect: () => onTool({ kind: "split", track: owned }) },
            ]}
          />
        ) : (
          <span />
        ))
      }
    />
  );
}

function Suggestions({ items, onChanged }: { items: SuggestionView[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);

  async function answer(item: SuggestionView, same: boolean) {
    setBusy(item.submissionId);
    try {
      const supabase = getBrowserClient();
      if (same) await confirmTrackSuggestion(supabase, item.submissionId);
      else await dismissTrackSuggestion(supabase, item.submissionId);
      onChanged();
    } catch (error) {
      notifyError(error, "Couldn't update that suggestion.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <ul className="flex flex-col gap-2" aria-label="Track suggestions">
      {items.map((item) => (
        <li key={item.submissionId} className="flex animate-drop-in flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-line-strong bg-surface px-4 py-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <Eyebrow>Same track?</Eyebrow>
            <p className="text-sm">
              Your upload{item.submittedAt ? ` from ${formatDate(item.submittedAt)}` : ""} in <span className="font-semibold">{item.fromTitle}</span> sounds like{" "}
              <span className="font-semibold">{item.toTitle}</span>.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => answer(item, false)} disabled={busy !== null}>
              Not the same
            </Button>
            <Button variant="primary" size="sm" onClick={() => answer(item, true)} loading={busy === item.submissionId} disabled={busy !== null && busy !== item.submissionId}>
              Same track
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
