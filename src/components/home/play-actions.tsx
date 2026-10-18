"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { CreateRoom } from "./create-room";
import { JoinCodeButton } from "./join-code-form";

export function PlayActions() {
  const { status } = useAuth();
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <JoinCodeButton />
      {status === "loading" && <Skeleton className="h-10 w-[9.25rem] rounded-full" />}
      {status === "signed_in" && (
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" />
          Create room
        </Button>
      )}
      <Dialog open={creating} onClose={() => setCreating(false)} title="Create room" className="max-h-[92dvh] max-w-lg overflow-y-auto">
        <CreateRoom showHeading={false} />
      </Dialog>
    </div>
  );
}
