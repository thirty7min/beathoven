"use client";

import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { AuthProvider } from "./auth-provider";
import { PresenceProvider } from "./presence-provider";
import { SoundProvider } from "./sound-provider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <PresenceProvider>
        <SoundProvider>
          {children}
          <Toaster theme="dark" position="top-center" closeButton visibleToasts={3} toastOptions={{ className: "font-sans" }} />
        </SoundProvider>
      </PresenceProvider>
    </AuthProvider>
  );
}
