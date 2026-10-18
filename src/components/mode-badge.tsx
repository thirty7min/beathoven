import { ModeIcon } from "@/components/home/mode-icon";
import { modeInfo } from "@/lib/game/room-settings";
import type { RoomMode } from "@/lib/game/types";
import { Badge } from "./ui/badge";
import { Tooltip } from "./ui/tooltip";

type ModeRoom = Parameters<typeof modeInfo>[0];

export function ModeTooltipContent({ room }: { room: ModeRoom }) {
  const info = modeInfo(room);
  return (
    <>
      <span className="flex items-center gap-1.5 font-semibold text-fg">
        <ModeIcon mode={room.mode} className="h-3.5 w-3.5" />
        {info.title}
      </span>
      <span className="block">{info.body}</span>
      {info.rules && <span className="mt-1 block text-fg/80">{info.rules}</span>}
    </>
  );
}

export function ModeBadge({ room, className }: { room: ModeRoom & { mode: RoomMode }; className?: string }) {
  return (
    <Tooltip content={<ModeTooltipContent room={room} />}>
      <Badge tone="outline" className={className ?? "uppercase"}>
        <ModeIcon mode={room.mode} />
        {modeInfo(room).title}
      </Badge>
    </Tooltip>
  );
}
