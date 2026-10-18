import { Disc3, FileAudio, Sparkles } from "lucide-react";
import type { RoomMode } from "@/lib/game/types";

export function ModeIcon({ mode, className }: { mode: RoomMode; className?: string }) {
  if (mode === "classic") return <Disc3 className={className} />;
  if (mode === "creative") return <Sparkles className={className} />;
  return <FileAudio className={className} />;
}
