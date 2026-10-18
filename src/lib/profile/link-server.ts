import "server-only";
import type { AdminClient } from "@/lib/uploads/server";
import { checkSafeBrowsing, type LinkCheckers } from "./link-safety";

let warnedMissingKey = false;

function safeBrowsingKey() {
  const key = process.env.GOOGLE_SAFE_BROWSING_API_KEY;
  if (!key && !warnedMissingKey) {
    warnedMissingKey = true;
    console.warn("GOOGLE_SAFE_BROWSING_API_KEY is not set; profile links are not checked against Safe Browsing.");
  }
  return key;
}

export function linkCheckers(admin: AdminClient): LinkCheckers {
  return {
    isBlockedDomain: async (hostname) => {
      const { data, error } = await admin.rpc("link_domain_blocked", { p_host: hostname });
      if (error) throw new Error(error.message);
      return data === true;
    },
    safeBrowsing: (url) => checkSafeBrowsing(url, { apiKey: safeBrowsingKey() }),
  };
}
