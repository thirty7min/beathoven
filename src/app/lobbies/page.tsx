import type { Metadata } from "next";
import { LobbiesScreen } from "@/components/lobbies/lobbies-screen";
import { PageTitle } from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";

export const metadata: Metadata = { title: "Lobbies" };

export default function LobbiesPage() {
  return (
    <PageShell>
      <PageTitle title="Lobbies" subtitle="Public rooms, refreshed every few seconds." />
      <LobbiesScreen />
    </PageShell>
  );
}
