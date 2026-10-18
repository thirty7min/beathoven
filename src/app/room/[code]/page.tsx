import type { Metadata } from "next";
import { Suspense } from "react";
import { RoomScreen, RoomSkeleton } from "@/components/room/room-screen";
import { PageShell } from "@/components/ui/page-shell";

export const metadata: Metadata = { title: "Room" };

export default function RoomPage({ params, searchParams }: PageProps<"/room/[code]">) {
  return (
    <PageShell className="py-8">
      <Suspense fallback={<RoomSkeleton />}>
        {Promise.all([params, searchParams]).then(([{ code }, query]) => (
          <RoomScreen code={code.toUpperCase()} debug={query.debug === "1"} />
        ))}
      </Suspense>
    </PageShell>
  );
}
