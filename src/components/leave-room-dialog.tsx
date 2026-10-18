"use client";

import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";

export function LeaveRoomDialog({
  open,
  currentCode,
  action,
  onConfirm,
  onCancel,
  busy,
}: {
  open: boolean;
  currentCode: string;
  action: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  return (
    <Dialog open={open} onClose={onCancel} title={`You'll leave room ${currentCode}`}>
      <p className="text-sm text-muted">
        You can only be in one room at a time. {action} will take you out of <span className="font-mono text-fg">{currentCode}</span>.
      </p>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Stay
        </Button>
        <Button variant="primary" onClick={onConfirm} loading={busy}>
          Leave and continue
        </Button>
      </div>
    </Dialog>
  );
}
