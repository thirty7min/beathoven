import type { Metadata } from "next";
import { LeaderboardScreen } from "@/components/leaderboard/leaderboard-screen";
import { PageTitle } from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";

export const metadata: Metadata = { title: "Leaderboard" };

export default function LeaderboardPage() {
  return (
    <PageShell>
      <PageTitle title="Leaderboard" subtitle="Top producers by wins across every battle." />
      <LeaderboardScreen />
    </PageShell>
  );
}
