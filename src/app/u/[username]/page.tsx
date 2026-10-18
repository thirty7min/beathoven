import type { Metadata } from "next";
import { Suspense } from "react";
import { ProfileScreen } from "@/components/profile/profile-screen";
import { PageShell } from "@/components/ui/page-shell";

export const metadata: Metadata = { title: "Profile" };

export default function ProfilePage({ params }: PageProps<"/u/[username]">) {
  return (
    <PageShell>
      <Suspense fallback={<div className="h-72 animate-pulse rounded-2xl border border-line bg-surface" />}>
        {params.then(({ username }) => (
          <ProfileScreen username={decodeURIComponent(username)} />
        ))}
      </Suspense>
    </PageShell>
  );
}
