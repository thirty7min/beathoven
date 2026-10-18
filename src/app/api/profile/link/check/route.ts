import { NextResponse, type NextRequest } from "next/server";
import { linkCheckFor, type LinkCheck } from "@/lib/profile/link-check";
import { linkCheckers } from "@/lib/profile/link-server";
import { resolveOutbound, type OutboundTarget } from "@/lib/profile/outbound";
import { USERNAME_PATTERN } from "@/lib/profile/validate";
import { createAdminClient } from "@/lib/supabase/admin";

function respond(body: LinkCheck, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function GET(request: NextRequest) {
  const username = request.nextUrl.searchParams.get("username") ?? "";
  if (!USERNAME_PATTERN.test(username)) return respond({ status: "none" }, 404);

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("get_profile_link", { p_username: username });
  if (error) return respond({ status: "unavailable" }, 503);
  const target = data as OutboundTarget | null;
  if (!target) return respond({ status: "none" }, 404);

  const state = await resolveOutbound(target, linkCheckers(admin));
  if (state.kind === "removed") await admin.rpc("clear_unsafe_link", { p_user_id: target.user_id, p_url: state.storedUrl });
  if (state.kind === "ready" && state.scanned) await admin.rpc("record_link_check", { p_url: state.url });
  return respond(linkCheckFor(state));
}
