import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNextPath(searchParams.get("next"));
  const providerError = searchParams.get("error_description") ?? searchParams.get("error");
  const code = searchParams.get("code");

  const fail = (message: string) => {
    const url = new URL(next, origin);
    url.searchParams.set("auth_error", message);
    return NextResponse.redirect(url);
  };

  if (providerError) return fail(providerError);
  if (!code) return fail("Missing sign-in code.");

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return fail(error.message);
  return NextResponse.redirect(new URL(next, origin));
}
