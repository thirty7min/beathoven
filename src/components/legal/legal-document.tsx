import Link from "next/link";
import type { ReactNode } from "react";
import { Card, PageTitle } from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";
import { CONTACT_EMAIL, formatLegalDate, LEGAL_LAST_UPDATED } from "@/lib/legal";

const LINK_CLASS = "font-medium text-fg underline underline-offset-4 transition-opacity hover:opacity-80";

export function LegalDocument({ title, intro, children }: { title: string; intro: ReactNode; children: ReactNode }) {
  return (
    <PageShell className="max-w-3xl">
      <PageTitle title={title} subtitle={`Last updated ${formatLegalDate(LEGAL_LAST_UPDATED)}`} />
      <Card className="flex flex-col gap-8 p-6 text-[15px] leading-relaxed text-muted sm:p-8">
        <div className="flex flex-col gap-3">{intro}</div>
        {children}
      </Card>
    </PageShell>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold tracking-tight text-fg">{title}</h2>
      {children}
    </section>
  );
}

export function LegalList({ children }: { children: ReactNode }) {
  return <ul className="flex list-disc flex-col gap-2 pl-5 marker:text-subtle">{children}</ul>;
}

export function Term({ children }: { children: ReactNode }) {
  return <span className="font-semibold text-fg">{children}</span>;
}

export function LegalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={LINK_CLASS}>
      {children}
    </Link>
  );
}

export function ContactEmail() {
  return (
    <a href={`mailto:${CONTACT_EMAIL}`} className={LINK_CLASS}>
      {CONTACT_EMAIL}
    </a>
  );
}
