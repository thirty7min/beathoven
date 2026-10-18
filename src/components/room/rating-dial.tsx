"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { MAX_SCORE, scoreAngle, scoreFromKey, scoreFromPoint, shouldSend, stepScore } from "@/lib/game/dial";
import { SCORE_LABELS, type VoteState } from "@/lib/game/voting";
import { Flames } from "./flames";

const W = 240;
const H = 150;
const CX = 120;
const CY = 118;
const OUTER = 112;
const INNER = 80;
const HUB = 32;
const SEGMENT = 180 / MAX_SCORE;
const GAP = 2;

function polar(angle: number, radius: number) {
  const rad = (angle * Math.PI) / 180;
  return `${(CX + radius * Math.cos(rad)).toFixed(2)} ${(CY - radius * Math.sin(rad)).toFixed(2)}`;
}

function segmentPath(index: number) {
  const from = 180 - index * SEGMENT - GAP / 2;
  const to = 180 - (index + 1) * SEGMENT + GAP / 2;
  return `M ${polar(from, OUTER)} A ${OUTER} ${OUTER} 0 0 1 ${polar(to, OUTER)} L ${polar(to, INNER)} A ${INNER} ${INNER} 0 0 0 ${polar(from, INNER)} Z`;
}

type DialSync = {
  draft: number | null;
  sent: number | null;
  sentAt: number | null;
  submissionId: string;
  onRate: (submissionId: string, score: number) => void;
};

function sendIfNeeded(sync: DialSync, score: number, dragging: boolean) {
  const now = performance.now();
  if (!shouldSend({ value: score, lastSent: sync.sent, dragging, msSinceLastSend: sync.sentAt === null ? null : now - sync.sentAt })) return;
  sync.sent = score;
  sync.sentAt = now;
  sync.onRate(sync.submissionId, score);
}

export function RatingDial({
  submissionId,
  state,
  onRate,
}: {
  submissionId: string;
  state: VoteState;
  onRate: (submissionId: string, score: number) => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const dragging = useRef(false);
  const sync = useRef<DialSync>({ draft: null, sent: null, sentAt: null, onRate, submissionId });
  const interactive = state.kind === "open";
  const value = state.kind === "unavailable" || state.kind === "own_track" ? null : (draft ?? state.score);

  useEffect(() => {
    sync.current.onRate = onRate;
    sync.current.submissionId = submissionId;
  });

  useEffect(() => {
    const pending = sync.current;
    const flush = () => {
      if (pending.draft === null || pending.draft === pending.sent) return;
      pending.sent = pending.draft;
      pending.onRate(pending.submissionId, pending.draft);
    };
    if (state.kind === "closed") flush();
    return flush;
  }, [state.kind]);

  function change(score: number, isDragging = false) {
    sync.current.draft = score;
    setDraft(score);
    sendIfNeeded(sync.current, score, isDragging);
  }

  useEffect(() => {
    if (!interactive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const next = scoreFromKey(e.key, sync.current.draft ?? (state.kind === "open" ? state.score : null));
      if (next === null) return;
      e.preventDefault();
      sync.current.draft = next;
      setDraft(next);
      sendIfNeeded(sync.current, next, false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [interactive, state]);

  if (state.kind === "unavailable") return null;

  function pick(e: PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W - CX;
    const y = CY - ((e.clientY - rect.top) / rect.height) * H;
    change(scoreFromPoint(x, y), dragging.current);
  }

  function endDrag() {
    if (!dragging.current) return;
    dragging.current = false;
    if (sync.current.draft !== null) sendIfNeeded(sync.current, sync.current.draft, false);
  }

  const dim = !interactive;

  return (
    <div className="flex flex-col items-center gap-4">
      <div className={cn("flex items-center gap-3 transition-opacity duration-200 ease-snappy sm:gap-8", dim && "opacity-40")}>
        <ArrowButton label="Lower rating" disabled={!interactive || value === 1} onClick={() => value !== null && change(stepScore(value, -1))}>
          <ChevronLeft className="h-6 w-6" />
        </ArrowButton>

        <div className="relative">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            role="slider"
            tabIndex={interactive ? 0 : -1}
            aria-label="Rating"
            aria-valuemin={1}
            aria-valuemax={MAX_SCORE}
            aria-valuenow={value ?? undefined}
            aria-valuetext={value ? `${value} · ${SCORE_LABELS[value]}` : "Not rated"}
            aria-disabled={!interactive}
            className={cn("relative w-[min(64vw,320px)] touch-none select-none focus:outline-none", interactive && "cursor-pointer")}
            onPointerDown={(e) => {
              if (!interactive) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              dragging.current = true;
              pick(e);
            }}
            onPointerMove={(e) => dragging.current && interactive && pick(e)}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {Array.from({ length: MAX_SCORE }, (_, i) => (
              <path
                key={i}
                d={segmentPath(i)}
                className={cn("transition-[fill] duration-150", value !== null && i < value ? "fill-fg" : "fill-white/10")}
              />
            ))}
            {value !== null && (
              <g
                style={{ transform: `rotate(${-scoreAngle(value)}deg)`, transformOrigin: `${CX}px ${CY}px` }}
                className="transition-transform duration-150 ease-snappy motion-reduce:transition-none"
              >
                <line x1={CX + HUB + 4} y1={CY} x2={CX + OUTER + 2} y2={CY} strokeWidth={4} strokeLinecap="round" className="stroke-fg" />
              </g>
            )}
          </svg>
          <div
            className="@container pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${(CX / W) * 100}%`, top: `${(CY / H) * 100}%`, width: `${((HUB * 2) / W) * 100}%`, aspectRatio: "1" }}
          >
            <Flames score={interactive || state.kind === "closed" ? value : null}>
              <output
                aria-hidden
                className="relative flex size-full items-center justify-center rounded-full border-[1.5px] border-line-strong bg-raised text-[52cqw] leading-none font-bold tabular-nums"
              >
                {value ?? "–"}
              </output>
            </Flames>
          </div>
        </div>

        <ArrowButton label="Raise rating" disabled={!interactive || value === MAX_SCORE} onClick={() => value !== null && change(stepScore(value, 1))}>
          <ChevronRight className="h-6 w-6" />
        </ArrowButton>
      </div>

    </div>
  );
}

function ArrowButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-line-strong bg-raised transition-[transform,background-color,border-color] duration-150 ease-snappy hover:border-fg hover:bg-hover active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100 disabled:hover:border-line-strong disabled:hover:bg-raised sm:h-14 sm:w-14"
    >
      {children}
    </button>
  );
}
