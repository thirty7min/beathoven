"use client";

import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { ActiveRoomProvider } from "./active-room-provider";
import { AuthProvider } from "./auth-provider";
import { OnboardingGate } from "./profile/onboarding-gate";
import { PresenceProvider } from "./presence-provider";
import { SoundProvider } from "./sound-provider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <PresenceProvider>
        <ActiveRoomProvider>
          <SoundProvider>
            {children}
            <OnboardingGate />
            <Toaster theme="dark" position="top-center" closeButton visibleToasts={3} toastOptions={{ className: "font-sans" }} />
          </SoundProvider>
        </ActiveRoomProvider>
      </PresenceProvider>
    </AuthProvider>
  );
}
