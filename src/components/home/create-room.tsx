"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { LeaveRoomDialog } from "@/components/leave-room-dialog";
import { Button } from "@/components/ui/button";
import { useCurrentRoom } from "@/hooks/use-current-room";
import { createRoom } from "@/lib/game/rpc";
import { getBrowserClient } from "@/lib/supabase/client";
import { DEFAULT_DRAFT, RoomSettingsForm, type RoomSettingsDraft } from "./room-settings-form";
import { notifyError } from "@/lib/ui/notify";

export function CreateRoom({ showHeading = true }: { showHeading?: boolean }) {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { room: currentRoom } = useCurrentRoom(user?.id ?? null);
  const [draft, setDraft] = useState<RoomSettingsDraft>(DEFAULT_DRAFT);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const { mode, name, ...settings } = draft;
      const room = await createRoom(getBrowserClient(), mode, { ...settings, name: name.trim() || undefined });
      router.push(`/room/${room.code}`);
    } catch (e) {
      notifyError(e, "Couldn't create the room.");
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      {showHeading && (
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Host a battle</h2>
          <p className="text-sm text-muted">Pick a mode, set the clock, share the code.</p>
        </div>
      )}
      <RoomSettingsForm value={draft} onChange={setDraft} namePlaceholder={profile ? `${profile.username}'s room` : undefined} />
      <div>
        <Button variant="primary" size="lg" className="w-full" loading={busy} onClick={() => (currentRoom ? setConfirming(true) : void create())}>
          <Plus className="h-4 w-4" />
          Create room
        </Button>
      </div>
      {currentRoom && (
        <LeaveRoomDialog
          open={confirming}
          currentCode={currentRoom.code}
          action="Creating a new room"
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void create()}
        />
      )}
    </section>
  );
}
