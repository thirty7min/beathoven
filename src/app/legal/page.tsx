import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card, PageTitle } from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";

export const metadata: Metadata = { title: "Legal" };

const DOCUMENTS = [
  { href: "/terms", title: "Terms of Service", description: "The rules for using Beathoven and what happens to the music you upload." },
  { href: "/privacy", title: "Privacy Policy", description: "What we collect, who can see it, how long we keep it and your rights." },
];

export default function LegalPage() {
  return (
    <PageShell className="max-w-3xl">
      <PageTitle title="Legal" />
      <div className="flex flex-col gap-3">
        {DOCUMENTS.map((doc) => (
          <Link key={doc.href} href={doc.href} className="group rounded-2xl">
            <Card className="flex items-center gap-4 p-6 transition-colors group-hover:border-line-strong">
              <div className="flex flex-1 flex-col gap-1">
                <h2 className="text-lg font-semibold tracking-tight">{doc.title}</h2>
                <p className="text-[15px] leading-relaxed text-muted">{doc.description}</p>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted transition-colors group-hover:text-fg" aria-hidden />
            </Card>
          </Link>
        ))}
      </div>
    </PageShell>
  );
}
