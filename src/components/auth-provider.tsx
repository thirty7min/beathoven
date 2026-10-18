"use client";

import type { User } from "@supabase/supabase-js";
import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { escapeLike, normalizeDisplayName, validateDisplayName } from "@/lib/profile/validate";
import { getBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";
import { notifyFailure } from "@/lib/ui/notify";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type OAuthProvider = "discord" | "google";

type AuthStatus = "loading" | "signed_out" | "signed_in";

type AuthContextValue = {
  status: AuthStatus;
  user: User | null;
  profile: Profile | null;
  isGuest: boolean;
  refreshProfile: () => Promise<void>;
  setProfile: (profile: Profile) => void;
  signInAsGuest: (displayName: string) => Promise<void>;
  signInWithProvider: (provider: OAuthProvider, next?: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export class AuthError extends Error {}

export async function isUsernameTaken(username: string, exceptUserId?: string): Promise<boolean> {
  const { data, error } = await getBrowserClient()
    .from("profiles")
    .select("id")
    .ilike("username", escapeLike(username))
    .limit(1);
  if (error) throw error;
  return data.some((row) => row.id !== exceptUserId);
}

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data } = await getBrowserClient().from("profiles").select("*").eq("id", userId).maybeSingle();
  return data;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [profileState, setProfileState] = useState<{ userId: string; profile: Profile | null } | null>(null);

  useEffect(() => {
    const supabase = getBrowserClient();
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setUser(data.session?.user ?? null);
      setStatus(data.session ? "signed_in" : "signed_out");
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setStatus(session ? "signed_in" : "signed_out");
    });

    const params = new URLSearchParams(window.location.search);
    const authError = params.get("auth_error");
    if (authError) {
      notifyFailure("Sign-in didn't complete", authError);
      params.delete("auth_error");
      const query = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    }

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  const userId = user?.id ?? null;
  const profile = userId && profileState?.userId === userId ? profileState.profile : null;

  const setProfile = useCallback((next: Profile) => setProfileState({ userId: next.id, profile: next }), []);

  const refreshProfile = useCallback(async () => {
    if (userId) setProfileState({ userId, profile: await fetchProfile(userId) });
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void fetchProfile(userId).then((data) => {
      if (!cancelled) setProfileState({ userId, profile: data });
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const signInAsGuest = useCallback(
    async (displayName: string) => {
    const name = normalizeDisplayName(displayName);
    const invalid = validateDisplayName(name);
    if (invalid) throw new AuthError(invalid);

    const supabase = getBrowserClient();
    const { data, error } = await supabase.auth.signInAnonymously({ options: { data: { display_name: name } } });
    if (error || !data.user) throw new AuthError(error?.message ?? "Couldn't start a guest session.");

    const profile = await fetchProfile(data.user.id);
    if (profile) setProfile(profile);
    },
    [setProfile],
  );

  const signInWithProvider = useCallback(async (provider: OAuthProvider, next?: string) => {
    const target = next ?? `${window.location.pathname}${window.location.search}`;
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(target)}`;
    const { error } = await getBrowserClient().auth.signInWithOAuth({ provider, options: { redirectTo } });
    if (error) throw new AuthError(error.message);
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await getBrowserClient().auth.signOut();
    if (error) throw new AuthError(error.message);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      profile,
      isGuest: user?.is_anonymous ?? false,
      refreshProfile,
      setProfile,
      signInAsGuest,
      signInWithProvider,
      signOut,
    }),
    [status, user, profile, refreshProfile, setProfile, signInAsGuest, signInWithProvider, signOut],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const value = use(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
