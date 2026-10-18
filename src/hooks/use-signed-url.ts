"use client";

import { useEffect, useState } from "react";
import { signedUrl } from "@/lib/game/storage";
import { getBrowserClient } from "@/lib/supabase/client";

const EXPIRES_IN_SECONDS = 3600;
const REUSE_FOR_MS = 50 * 60_000;

const cache = new Map<string, { promise: Promise<string>; createdAt: number }>();

export function getSignedUrl(bucket: string, path: string): Promise<string> {
  const key = `${bucket}/${path}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.createdAt < REUSE_FOR_MS) return hit.promise;
  const promise = signedUrl(getBrowserClient(), bucket, path, EXPIRES_IN_SECONDS);
  promise.catch(() => cache.delete(key));
  cache.set(key, { promise, createdAt: Date.now() });
  return promise;
}

type SignedUrlState = { key: string | null; url: string | null; error: boolean };

export function useSignedUrl(bucket: string, path: string | null | undefined) {
  const key = path ? `${bucket}/${path}` : null;
  const [state, setState] = useState<SignedUrlState>({ key: null, url: null, error: false });

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    getSignedUrl(bucket, path).then(
      (url) => !cancelled && setState({ key: `${bucket}/${path}`, url, error: false }),
      () => !cancelled && setState({ key: `${bucket}/${path}`, url: null, error: true }),
    );
    return () => {
      cancelled = true;
    };
  }, [bucket, path]);

  const current = state.key === key ? state : { url: null, error: false };
  return { url: current.url, error: current.error, loading: Boolean(key) && !current.url && !current.error };
}
