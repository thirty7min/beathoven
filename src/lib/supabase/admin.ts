import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { supabaseEnv } from "./env";

export function createAdminClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY must be set");
  return createClient<Database>(supabaseEnv().url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function devToolsAllowed() {
  return process.env.ENABLE_DEV_TOOLS === "true" && process.env.NODE_ENV !== "production" && !process.env.VERCEL;
}
