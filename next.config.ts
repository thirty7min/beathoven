import type { NextConfig } from "next";
import { version } from "./package.json";

const nextConfig: NextConfig = {
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
};

export default nextConfig;
