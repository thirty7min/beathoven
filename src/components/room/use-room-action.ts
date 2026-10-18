"use client";

import { useCallback, useState } from "react";
import { notifyError } from "@/lib/ui/notify";

export function useRoomAction() {
  const [pending, setPending] = useState<string | null>(null);

  const run = useCallback(async <T,>(key: string, fn: () => Promise<T>, fallback?: string): Promise<T | undefined> => {
    setPending(key);
    try {
      return await fn();
    } catch (error) {
      notifyError(error, fallback);
      return undefined;
    } finally {
      setPending((current) => (current === key ? null : current));
    }
  }, []);

  return { pending, run };
}
