export function siteUrl(env: Record<string, string | undefined> = process.env): URL {
  if (env.NEXT_PUBLIC_SITE_URL) return new URL(env.NEXT_PUBLIC_SITE_URL);
  const vercelHost = env.VERCEL_ENV === "production" ? env.VERCEL_PROJECT_PRODUCTION_URL : env.VERCEL_URL;
  return new URL(vercelHost ? `https://${vercelHost}` : "http://localhost:3000");
}
