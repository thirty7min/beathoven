"use client";

import { Card, Eyebrow } from "@/components/ui/card";
import type { RoomController } from "./types";

export function RoomDebug({ room }: { room: RoomController }) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <Eyebrow>Debug</Eyebrow>
      <p className="font-mono text-xs text-muted">
        connection: {room.connection}
        {room.error && ` (${room.error})`} · clock offset: {Math.round(room.clock.offset)}ms · version: {room.snapshot?.version ?? "–"}
      </p>
      <pre className="scrollbar-thin max-h-[32rem] overflow-auto font-mono text-[11px] text-muted">
        {JSON.stringify({ online: room.online, snapshot: room.snapshot }, null, 2)}
      </pre>
    </Card>
  );
}
