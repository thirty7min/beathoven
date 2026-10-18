import { DEFAULT_SCORE } from "@/lib/game/voting";
import type { RoomSnapshot } from "@/lib/game/types";
import { playbackBoostDb } from "./loudness";

export type ReviewRow = {
  submissionId: string;
  position: number;
  label: string;
  producerId: string | null;
  storagePath: string | null;
  clipStartMs: number;
  clipMs: number;
  mine: boolean;
  boostDb: number;
  score: number;
  auto: boolean;
};

export function reviewRows(snapshot: RoomSnapshot, overrides: Record<string, number> = {}): ReviewRow[] {
  const rows = (snapshot.my_review ?? []).map((entry) => {
    const submission = snapshot.submissions.find((s) => s.id === entry.submission_id);
    const override = overrides[entry.submission_id];
    return {
      submissionId: entry.submission_id,
      position: entry.position,
      label: `Track ${entry.position}`,
      producerId: snapshot.room.reveal_names ? (submission?.user_id ?? null) : null,
      storagePath: submission?.storage_path ?? null,
      clipStartMs: entry.clip_start_ms,
      clipMs: Math.max(0, entry.clip_end_ms - entry.clip_start_ms),
      mine: entry.is_mine,
      boostDb: playbackBoostDb(entry),
      score: override ?? entry.my_vote ?? DEFAULT_SCORE,
      auto: override === undefined && (entry.my_vote === null || entry.is_default),
    };
  });
  return rows.sort((a, b) => Number(a.mine) - Number(b.mine));
}

export function settledOverrides(snapshot: RoomSnapshot, overrides: Record<string, number>): Record<string, number> {
  const entries = snapshot.my_review ?? [];
  const pending = Object.entries(overrides).filter(([id, score]) => {
    const entry = entries.find((e) => e.submission_id === id);
    return entry !== undefined && !(entry.my_vote === score && !entry.is_default);
  });
  return pending.length === Object.keys(overrides).length ? overrides : Object.fromEntries(pending);
}

export function reviewProgress(snapshot: RoomSnapshot): { done: number; total: number; meDone: boolean } {
  const doneIds = snapshot.review?.done_user_ids ?? [];
  return { done: doneIds.length, total: snapshot.review?.total ?? 0, meDone: doneIds.includes(snapshot.me) };
}
