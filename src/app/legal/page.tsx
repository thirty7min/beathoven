import type { Metadata } from "next";
import { Card, PageTitle } from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";

export const metadata: Metadata = { title: "Legal" };

export default function LegalPage() {
  return (
    <PageShell className="max-w-3xl">
      <PageTitle title="Legal" />
      <Card className="flex flex-col gap-4 p-6 text-[15px] leading-relaxed text-muted">
        <p>Terms of service and privacy policy are coming soon.</p>
        <p>Only upload music you own or have the rights to share. Tracks are visible to the players in your room.</p>
      </Card>
    </PageShell>
  );
}
