import type { Metadata } from "next";
import { Suspense } from "react";
import { ProfileScreen, ProfileSkeleton } from "@/components/profile/profile-screen";
import { PageShell } from "@/components/ui/page-shell";

export const metadata: Metadata = { title: "Profile" };

export default function ProfilePage({ params }: PageProps<"/u/[username]">) {
  return (
    <PageShell>
      <Suspense fallback={<ProfileSkeleton />}>
        {params.then(({ username }) => (
          <ProfileScreen username={decodeURIComponent(username)} />
        ))}
      </Suspense>
    </PageShell>
  );
}
