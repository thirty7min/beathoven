import { toGameError } from "@/lib/game/errors";
import type { TypedSupabaseClient } from "@/lib/supabase/client";
import type { DawSlug } from "./daws";
import { USERNAME_PATTERN, normalizeDisplayName } from "./validate";

export type OnboardingInput = {
  displayName: string;
  username: string;
  bio?: string;
  daws?: DawSlug[];
};

export type OnboardedProfile = { id: string; display_name: string; username: string; bio: string; daws: DawSlug[] };

export function needsOnboarding(
  profile: { onboarded_at: string | null } | null | undefined,
  user: { is_anonymous?: boolean | null } | null | undefined,
): boolean {
  return !!user && !user.is_anonymous && !!profile && !profile.onboarded_at;
}

export async function completeOnboarding(supabase: TypedSupabaseClient, input: OnboardingInput): Promise<OnboardedProfile> {
  const { data, error } = await supabase.rpc("complete_onboarding", {
    p_display_name: normalizeDisplayName(input.displayName),
    p_username: input.username.trim(),
    p_bio: input.bio?.trim() ?? "",
    p_daws: input.daws ?? [],
  });
  if (error) throw toGameError(error);
  return data as OnboardedProfile;
}

export async function isUsernameAvailable(supabase: TypedSupabaseClient, username: string): Promise<boolean> {
  const candidate = username.trim();
  if (!USERNAME_PATTERN.test(candidate)) return false;
  const { data, error } = await supabase.rpc("username_available", { p_username: candidate });
  if (error) throw toGameError(error);
  return data === true;
}
