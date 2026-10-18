"use client";

import { Card, Eyebrow } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress";
import { formatClock } from "@/lib/game/format";
import { UPLOAD_GRACE_MS, phaseCountdown } from "@/lib/game/phase";
import { submitPhaseCopy } from "@/lib/game/phase-label";
import { phaseStat } from "@/lib/game/room-view";
import { isSpectating } from "@/lib/game/spectate";
import { SampleList } from "./sample-list";
import { StageCounter, StageHeader } from "./stage";
import type { RoomController } from "./types";
import { UploadPanel } from "./upload-panel";

export function ProducingView({ room, serverNow }: { room: RoomController; serverNow: number | null }) {
  const snapshot = room.snapshot!;
  const { room: state } = snapshot;
  const phaseEnd = state.phase_ends_at ? Date.parse(state.phase_ends_at) : null;
  const produceEnd = phaseEnd !== null ? phaseEnd - UPLOAD_GRACE_MS : null;
  const now = serverNow ?? Date.parse(snapshot.server_time);
  const produceOver = produceEnd !== null && now >= produceEnd;
  const closed = phaseEnd !== null && now >= phaseEnd;
  const elapsed = produceEnd !== null ? 1 - Math.max(0, produceEnd - now) / (state.produce_seconds * 1000) : 0;
  const mySubmission = snapshot.my_submission ?? null;
  const prompt = snapshot.assets.find((a) => a.kind === "prompt")?.prompt;
  const copy = submitPhaseCopy(state.mode);
  const countdown = phaseCountdown(state, snapshot.submissions, now);
  const remaining = countdown?.label === "produce" ? countdown.remainingMs : 0;
  const clockLabel = countdown?.label === "upload" ? "Time's up, last uploads landing" : copy.countdown;
  const submitted = phaseStat(snapshot);
  const spectating = isSpectating(snapshot);

  return (
    <div className="flex min-h-full flex-col">
      <StageHeader title={copy.title} aside={submitted && <StageCounter label="Submitted" value={`${submitted.done}/${submitted.total}`} />} />

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-5 pt-6 pb-12 sm:px-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-[clamp(4.5rem,15vw,9.5rem)] leading-none font-black tracking-tighter tabular-nums" role="timer" aria-live="off">
            {formatClock(remaining)}
          </p>
          <p className="text-sm text-muted">{clockLabel}</p>
          <ProgressBar value={elapsed} className="mt-3 h-1 max-w-md" />
        </div>

        {state.mode === "classic" && (
          <section className="flex flex-col gap-4">
            <h2 className="text-xl font-bold">Sample pack</h2>
            <Card className="p-5">
              <SampleList assets={snapshot.assets} />
            </Card>
          </section>
        )}
        {state.mode === "creative" && (
          <section className="flex flex-col items-center gap-3 text-center">
            <Eyebrow>{spectating ? "The prompt" : "Your prompt"}</Eyebrow>
            <p className="text-3xl leading-tight font-bold tracking-tight text-balance sm:text-4xl">
              {prompt ? `“${prompt}”` : "No prompt this time. Make anything you like."}
            </p>
            <p className="text-sm text-muted">Interpret it however you want. No other rules.</p>
          </section>
        )}
        {state.mode === "premade" && (
          <section className="flex flex-col items-center gap-2 text-center">
            <Eyebrow>Premade</Eyebrow>
            <p className="text-2xl font-bold tracking-tight sm:text-3xl">Upload a track you&apos;ve already made.</p>
            <p className="text-sm text-muted">You have 3 minutes. Only share music you own.</p>
          </section>
        )}

        {spectating ? (
          <p className="text-center text-sm text-muted">You&apos;re spectating. Tracks play for everyone once the timer ends.</p>
        ) : (
          <section className="flex flex-col gap-4">
            <h2 className="text-xl font-bold">Your submission</h2>
            <UploadPanel
              room={room}
              mySubmission={mySubmission}
              closesInMs={phaseEnd !== null ? Math.max(0, phaseEnd - now) : null}
              lastCall={produceOver}
              closed={closed}
            />
          </section>
        )}
      </div>
    </div>
  );
}
