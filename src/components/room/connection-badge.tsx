import { WifiOff } from "lucide-react";
import { cn } from "@/components/ui/cn";
import type { ConnectionStatus } from "@/lib/game/room-store";

const LABELS: Record<ConnectionStatus, string> = {
  connecting: "Connecting",
  live: "Connected",
  reconnecting: "Reconnecting",
  error: "Disconnected",
};

const DOTS: Record<ConnectionStatus, string> = {
  connecting: "bg-subtle animate-pulse",
  live: "bg-online",
  reconnecting: "bg-warn animate-pulse",
  error: "bg-danger",
};

export function ConnectionBadge({ status, compact }: { status: ConnectionStatus; compact?: boolean }) {
  return (
    <span
      role="status"
      aria-live="polite"
      title={compact ? LABELS[status] : undefined}
      className={cn("inline-flex items-center gap-2 text-[13px] font-medium text-muted", compact && "h-9 w-9 justify-center")}
    >
      <span className={cn("h-2 w-2 rounded-full", DOTS[status])} />
      <span className={cn(compact && "sr-only")}>{LABELS[status]}</span>
    </span>
  );
}

export function ReconnectingNotice({ className }: { className?: string }) {
  return (
    <div role="status" className={cn("flex items-center gap-3 rounded-xl border border-line bg-raised px-4 py-3 text-sm", className)}>
      <WifiOff className="h-4 w-4 shrink-0 text-muted" />
      Connection dropped. Reconnecting… your progress is safe.
    </div>
  );
}
