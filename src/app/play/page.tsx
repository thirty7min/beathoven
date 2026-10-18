import type { Metadata } from "next";
import { PlayActions } from "@/components/home/play-actions";
import { PlayScreen } from "@/components/home/play-screen";
import { PageTitle } from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";

export const metadata: Metadata = { title: "Play" };

export default function PlayPage() {
  return (
    <PageShell>
      <PageTitle title="Play" subtitle="Join a lobby, start your own, or queue for a match." aside={<PlayActions />} />
      <PlayScreen />
    </PageShell>
  );
}
