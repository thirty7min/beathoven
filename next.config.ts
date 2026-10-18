import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { networkInterfaces } from "node:os";
import { version } from "./package.json";

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((entry) => entry?.family === "IPv4" && !entry.internal)
    .map((entry) => entry!.address);
}

const nextConfig = (phase: string): NextConfig => ({
  allowedDevOrigins: phase === PHASE_DEVELOPMENT_SERVER ? lanAddresses() : [],
  cacheComponents: true,
  partialPrefetching: true,
  outputFileTracingIncludes: {
    "/api/uploads/verify": ["./vendor/fpcalc/linux-x86_64/**"],
    "/api/cron/uploads": ["./vendor/fpcalc/linux-x86_64/**"],
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
});

export default nextConfig;
