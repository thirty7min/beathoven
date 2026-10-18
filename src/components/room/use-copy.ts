"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { notifyFailure } from "@/lib/ui/notify";

export function useCopy() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(async (text: string, message = "Copied") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(message);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      notifyFailure("Couldn't copy. Select it and copy manually.");
    }
  }, []);

  return { copied, copy };
}
