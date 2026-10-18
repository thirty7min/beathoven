import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";
import { Skeleton, SkeletonGroup, SkeletonText } from "@/components/ui/skeleton";
import { linkCheckers } from "@/lib/profile/link-server";
import { resolveOutbound, type OutboundTarget } from "@/lib/profile/outbound";
import { USERNAME_PATTERN } from "@/lib/profile/validate";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Leaving Beathoven", robots: { index: false, follow: false } };

function decodeUsername(raw: string) {
  try {
    const username = decodeURIComponent(raw);
    return USERNAME_PATTERN.test(username) ? username : null;
  } catch {
    return null;
  }
}

function Notice({ title, body, backHref }: { title: string; body: string; backHref: string }) {
  return (
    <Card className="flex w-full max-w-lg flex-col gap-4 p-8">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <p className="text-sm text-muted">{body}</p>
      <Link href={backHref} className={buttonClasses("outline", "md")}>
        Back
      </Link>
    </Card>
  );
}

async function Outbound({ username }: { username: string }) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("get_profile_link", { p_username: username });
  if (error) throw new Error(error.message);
  const target = data as OutboundTarget | null;
  if (!target) notFound();

  const backHref = `/u/${encodeURIComponent(target.username)}`;
  const state = await resolveOutbound(target, linkCheckers(admin));

  if (state.kind === "none") {
    return <Notice title="No link" body={`${target.username} hasn't added a link.`} backHref={backHref} />;
  }
  if (state.kind === "removed") {
    await admin.rpc("clear_unsafe_link", { p_user_id: target.user_id, p_url: state.storedUrl });
    return (
      <Notice
        title="This link was removed"
        body="It was flagged as unsafe, so it's been taken off this profile."
        backHref={backHref}
      />
    );
  }
  if (state.kind === "unavailable") {
    return <Notice title="Can't check this link" body="We couldn't check this link right now. Try again in a minute." backHref={backHref} />;
  }
  if (state.scanned) await admin.rpc("record_link_check", { p_url: state.url });

  return (
    <Card className="flex w-full max-w-lg flex-col gap-6 p-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight">You&apos;re leaving Beathoven</h1>
        <p className="text-sm text-muted">This link was added by {target.username}. Only continue if you trust it.</p>
      </div>
      <div className="flex flex-col gap-1.5 rounded-xl border border-line px-4 py-3">
        <p className="text-xl font-semibold break-all">{state.hostname}</p>
        <p className="font-mono text-xs break-all text-muted">{state.url}</p>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Link href={backHref} className={buttonClasses("outline", "md")}>
          Back
        </Link>
        <a href={state.url} rel="noopener noreferrer nofollow ugc" referrerPolicy="no-referrer" className={buttonClasses("primary", "md")}>
          Continue
        </a>
      </div>
    </Card>
  );
}

function OutboundSkeleton() {
  return (
    <SkeletonGroup label="Checking this link" className="w-full max-w-lg">
      <Card className="flex flex-col gap-6 p-8">
        <div className="flex flex-col gap-2">
          <SkeletonText className="w-64 text-2xl" />
          <SkeletonText className="w-full text-sm" />
        </div>
        <div className="flex flex-col gap-1.5 rounded-xl border border-line px-4 py-3">
          <SkeletonText className="w-40 text-xl" />
          <SkeletonText className="w-64 text-xs" />
        </div>
        <div className="flex justify-end gap-2">
          <Skeleton className="h-10 w-20 rounded-full" />
          <Skeleton className="h-10 w-28 rounded-full" />
        </div>
      </Card>
    </SkeletonGroup>
  );
}

export default function OutboundPage({ params }: PageProps<"/out/[username]">) {
  return (
    <PageShell className="items-center justify-center">
      <Suspense fallback={<OutboundSkeleton />}>
        {params.then(({ username }) => {
          const decoded = decodeUsername(username);
          if (!decoded) notFound();
          return <Outbound username={decoded} />;
        })}
      </Suspense>
    </PageShell>
  );
}
