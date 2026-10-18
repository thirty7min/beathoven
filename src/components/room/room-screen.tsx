"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AuthPanel } from "@/components/auth-panel";
import { useAuth } from "@/components/auth-provider";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useCurrentRoom } from "@/hooks/use-current-room";
import { useVisit } from "@/hooks/use-on-hide";
import { useRoom } from "@/hooks/use-room";
import { useServerNow } from "@/hooks/use-server-now";
import { friendlyError } from "@/lib/game/error-messages";
import { joinGateView } from "@/lib/game/join-gate";
import { isRemovedError, wasRemoved } from "@/lib/game/kick";
import { leaveNeedsConfirm } from "@/lib/game/leave";
import { isRoomCode } from "@/lib/game/room-settings";
import { ReconnectingNotice } from "./connection-badge";
import { GameShell } from "./game-shell";
import { ListeningView } from "./listening-view";
import { LobbyView } from "./lobby-view";
import { ProducingView } from "./producing-view";
import { ResultsView } from "./results-view";
import { ReviewView } from "./review-view";
import { RoomDebug } from "./room-debug";
import { useRoomAction } from "./use-room-action";

export function RoomScreen({ code, debug }: { code: string; debug: boolean }) {
  const { status, user } = useAuth();
  const visit = useVisit();

  if (!isRoomCode(code)) {
    return <Notice title="That isn't a room code" body="Room codes are 6 letters and numbers, like ABC123." />;
  }
  if (status === "loading") return <RoomSkeleton />;
  if (status === "signed_out" || !user) {
    return (
      <Card className="mx-auto w-full max-w-xl p-6 sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight">
          Join room <span className="font-mono tracking-wider">{code}</span>
        </h1>
        <p className="mt-1 mb-6 text-sm text-muted">Pick a name to jump in, or sign in to keep your stats.</p>
        <AuthPanel next={`/room/${code}`} />
      </Card>
    );
  }
  return <JoinGate key={`${user.id}:${visit}`} code={code} userId={user.id} debug={debug} />;
}

function JoinGate({ code, userId, debug }: { code: string; userId: string; debug: boolean }) {
  const { room: current, loading } = useCurrentRoom(userId);
  const [confirmed, setConfirmed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const view = joinGateView({ loading, current, code, confirmed });
  if (view === "loading") return <RoomSkeleton />;
  if (view === "confirm" && current) {
    return (
      <Card className="mx-auto flex w-full max-w-xl flex-col gap-4 p-6 sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight">You&apos;ll leave room {current.code}</h1>
        <p className="text-sm text-muted">
          You can only be in one room at a time. Joining <span className="font-mono text-fg">{code}</span> takes you out of{" "}
          <span className="font-mono text-fg">{current.code}</span>
          {leaveNeedsConfirm(current.status) ? ", which has a game in progress." : "."}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => setConfirmed(true)}>
            Join {code}
          </Button>
          <Link href={`/room/${current.code}`} className={buttonClasses("outline", "md")}>
            Back to {current.code}
          </Link>
        </div>
      </Card>
    );
  }
  return <RoomLive key={attempt} code={code} debug={debug} onRetry={() => setAttempt((a) => a + 1)} />;
}

function RoomLive({ code, debug, onRetry }: { code: string; debug: boolean; onRetry: () => void }) {
  const room = useRoom(code);
  const router = useRouter();
  const { pending, run } = useRoomAction();
  const listening = room.snapshot?.room.status === "listening";
  const serverNow = useServerNow(room.clock, listening ? 100 : 250);
  const { snapshot } = room;
  const [leftOnPurpose, setLeftOnPurpose] = useState(false);
  const redirected = useRef(false);
  const removed =
    (room.connection === "error" && isRemovedError(room.error)) ||
    (snapshot !== null && snapshot.room.status !== "closed" && !leftOnPurpose && wasRemoved(snapshot.players, snapshot.me));

  useEffect(() => {
    if (!removed || redirected.current) return;
    redirected.current = true;
    toast("You were removed from the room");
    router.push("/play");
  }, [removed, router]);

  if (removed) return <RoomSkeleton label="Leaving room…" />;
  if (room.connection === "error") {
    return (
      <Notice title="Couldn't open this room" body={friendlyError({ message: room.error }, "The connection failed. Please try again.")}>
        <Button variant="primary" onClick={onRetry}>
          Try again
        </Button>
      </Notice>
    );
  }
  if (!snapshot) return <RoomSkeleton label="Joining room…" />;

  async function leave() {
    setLeftOnPurpose(true);
    const left = await run("leave", async () => {
      await room.actions.leave();
      return true;
    });
    if (left) router.push("/");
    else setLeftOnPurpose(false);
  }

  const { status } = snapshot.room;
  const leaving = pending === "leave";

  if (status === "lobby" || status === "closed") {
    return (
      <div className="flex flex-col gap-4">
        {room.connection === "reconnecting" && <ReconnectingNotice />}
        {status === "lobby" ? (
          <LobbyView room={room} serverNow={serverNow} onLeave={leave} leaving={leaving} />
        ) : (
          <Notice title="This room has closed" body="Everyone left. Start a new one from Play." />
        )}
        {debug && <RoomDebug room={room} />}
      </div>
    );
  }

  return (
    <GameShell room={room} serverNow={serverNow} onLeave={leave} leaving={leaving}>
      {status === "producing" && <ProducingView room={room} serverNow={serverNow} />}
      {status === "listening" && <ListeningView room={room} serverNow={serverNow} />}
      {status === "reviewing" && <ReviewView room={room} serverNow={serverNow} />}
      {status === "results" && <ResultsView snapshot={snapshot} serverNow={serverNow} />}
      {debug && (
        <div className="px-5 pb-6">
          <RoomDebug room={room} />
        </div>
      )}
    </GameShell>
  );
}

function Notice({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <Card className="mx-auto flex w-full max-w-xl flex-col items-start gap-4 p-6 sm:p-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted">{body}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {children}
        <Link href="/play" className={buttonClasses("outline", "md")}>
          Back to Play
        </Link>
      </div>
    </Card>
  );
}

export function RoomSkeleton({ label = "Loading room…" }: { label?: string }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]" aria-busy="true" aria-label={label}>
      <div className="flex flex-col gap-6">
        <div className="h-64 animate-pulse rounded-2xl border border-line bg-surface" />
        <div className="h-80 animate-pulse rounded-2xl border border-line bg-surface" />
      </div>
      <div className="hidden h-[32rem] animate-pulse rounded-2xl border border-line bg-surface lg:block" />
    </div>
  );
}
