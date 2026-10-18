import type { Metadata } from "next";
import { PlayActions } from "@/components/home/play-actions";
import { PlayScreen } from "@/components/home/play-screen";
import { PageTitle } from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";
import { QUEUE_ENABLED } from "@/lib/features";

export const metadata: Metadata = { title: "Play" };

export default function PlayPage() {
  return (
    <PageShell>
      <PageTitle title="Play" subtitle={QUEUE_ENABLED ? "Join a lobby, start your own, or queue for a match." : "Join a lobby or start your own."} aside={<PlayActions />} />
      <PlayScreen />
    </PageShell>
  );
}
