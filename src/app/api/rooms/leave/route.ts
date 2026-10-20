import { NextResponse, type NextRequest } from "next/server";
import { isSameOriginRequest, parseLeaveBeacon } from "@/lib/game/leave";
import { createClient } from "@/lib/supabase/server";
import { readCapped, uploadError } from "@/lib/uploads/server";

const MAX_REQUEST_BYTES = 256;

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request.headers)) return uploadError("forbidden", 403);
  const bytes = await readCapped(request, MAX_REQUEST_BYTES);
  const tabId = bytes ? parseLeaveBeacon(new TextDecoder().decode(bytes)) : null;
  if (!tabId) return uploadError("invalid_request");

  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_leave_pending", { p_tab_id: tabId });
  if (error) return uploadError(error.message);
  return new NextResponse(null, { status: 204 });
}
