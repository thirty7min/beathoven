import { NextResponse, type NextRequest } from "next/server";
import { linkCheckers } from "@/lib/profile/link-server";
import { vetLink, type LinkVerdict } from "@/lib/profile/link-safety";
import { createAdminClient } from "@/lib/supabase/admin";
import { readCapped, signedInUser, uploadError } from "@/lib/uploads/server";

const MAX_REQUEST_BYTES = 2048;

const STATUS_BY_CODE: Record<string, number> = {
  invalid_link: 400,
  link_shortener_not_allowed: 422,
  unsafe_link: 422,
  link_check_unavailable: 503,
  link_rate_limited: 429,
  profile_not_found: 404,
};

function linkError(code: string) {
  return uploadError(code, STATUS_BY_CODE[code] ?? 500);
}

async function readUrl(request: NextRequest): Promise<{ url: string | null } | null> {
  const bytes = await readCapped(request, MAX_REQUEST_BYTES);
  if (!bytes) return null;
  try {
    const body = JSON.parse(new TextDecoder().decode(bytes)) as { url?: unknown } | null;
    if (body?.url === null) return { url: null };
    return typeof body?.url === "string" ? { url: body.url.trim() || null } : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const caller = await signedInUser();
  if (!caller) return uploadError("not_authenticated");
  const body = await readUrl(request);
  if (!body) return linkError("invalid_link");

  const admin = createAdminClient();
  const claimed = await admin.rpc("claim_link_attempt", { p_user_id: caller.userId });
  if (claimed.error) return linkError(claimed.error.message);

  let verdict: LinkVerdict | null = null;
  if (body.url !== null) {
    verdict = await vetLink(body.url, linkCheckers(admin)).catch(
      (): LinkVerdict => ({ ok: false, code: "link_check_unavailable" }),
    );
    if (!verdict.ok) return linkError(verdict.code);
  }

  const saved = await admin.rpc("set_profile_link", { p_user_id: caller.userId, p_url: verdict?.url ?? null });
  if (saved.error) return linkError(saved.error.message);
  if (verdict?.scanned) await admin.rpc("record_link_check", { p_url: verdict.url });
  return NextResponse.json({ linkUrl: verdict?.url ?? null });
}
