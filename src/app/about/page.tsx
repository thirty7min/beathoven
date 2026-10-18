import type { Metadata } from "next";
import { Card, PageTitle } from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";

export const metadata: Metadata = { title: "About" };

export default function AboutPage() {
  return (
    <PageShell className="max-w-3xl">
      <PageTitle title="About" />
      <Card className="flex flex-col gap-4 p-6 text-[15px] leading-relaxed text-muted">
        <p>
          Beathoven is a live producer game. Everyone in a room makes a track against the same clock in their own DAW, uploads it,
          then the whole room listens together and rates every track from 1 to 5.
        </p>
        <p>
          <span className="font-semibold text-fg">Classic</span> hands everyone the same sample pack.{" "}
          <span className="font-semibold text-fg">Creative</span> gives a random prompt.{" "}
          <span className="font-semibold text-fg">Premade</span> lets you bring something you&apos;ve already made.
        </p>
      </Card>
    </PageShell>
  );
}
