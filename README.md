# Beathoven

Multiplayer beat battles: Next.js (App Router) + Supabase (Postgres, Auth, Realtime, Storage).

## Setup

1. `pnpm install`
2. Copy `.env.example` to `.env.local` and fill in the values from your Supabase project.
3. `supabase link --project-ref <ref>` then `supabase db push` to apply `supabase/migrations`.
4. In the Supabase dashboard:
   - Auth: enable anonymous sign-ins (guests play without an account).
   - Realtime settings: disable "Allow public access" so room channels are private-only.
   - Database extensions: pg_cron should be available; the cron migration schedules `public.sweep_rooms()` every 15 seconds.

## Scripts

- `pnpm dev`: start Next.js
- `pnpm typecheck`: generate route types and run `tsc`
- `pnpm lint`
- `pnpm test`: unit tests plus the SQL state machine tests, which run the migrations in PGlite against stubbed `auth`, `realtime` and `storage` schemas (`supabase/tests/stubs.sql`)

## How room state works

- Postgres is authoritative. Clients change game state only through the SECURITY DEFINER RPCs in `supabase/migrations/*_state_machine.sql`.
- Every state change bumps `rooms.version`, and a deferred trigger broadcasts the full public room state to the private topic `room:<room_id>`.
- `src/lib/game/room-connection.ts` fetches a snapshot, subscribes to the room topic and Presence, drops stale versions, and refetches on reconnect, tab wake or a version gap. Any member's client calls `advance_room` once a deadline passes, and pg_cron sweeps rooms nobody is watching.

## Deploy to Vercel

Production uses the existing Supabase project and the domain `beathoven.io`.

### 1. Vercel project

- Import the repo. Framework preset Next.js; the build command stays `pnpm build` (it downloads the Linux `fpcalc` binary into `vendor/fpcalc` before `next build`).
- Set `ENABLE_EXPERIMENTAL_COREPACK=1` so Vercel uses the pnpm version pinned in `package.json`.
- Domains: add `beathoven.io` as the primary domain and `www.beathoven.io` redirecting (308) to the apex.
- Environment variables:

| Variable | Scope | Required |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | All | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | All | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | All, mark Sensitive | Yes |
| `CRON_SECRET` | Production, mark Sensitive (`openssl rand -hex 32`) | Yes |
| `NEXT_PUBLIC_SITE_URL` = `https://beathoven.io` | Production only | Recommended (falls back to the Vercel production domain) |
| `GOOGLE_SAFE_BROWSING_API_KEY` | All | Optional; profile links skip the Safe Browsing check without it |
| `FPCALC_PATH` | | Leave unset; the bundled binary is used |
| `ENABLE_DEV_TOOLS` | | **Never set.** `/api/dev/*` returns 404 on Vercel regardless |

The `SUPABASE_AUTH_EXTERNAL_*` values in `.env.local` are only for `supabase config push`; Vercel doesn't need them.

### 2. Supabase (Auth → URL Configuration)

- Site URL: `https://beathoven.io`
- Redirect URLs: keep `http://localhost:3000/auth/callback`, add `https://beathoven.io/**` and the preview wildcard `https://*-<vercel-team-slug>.vercel.app/**`.
- `supabase/config.toml` still declares the localhost site URL. Update it before any `supabase config push`, or the push reverts these settings.

### 3. Google OAuth (Google Cloud → Credentials → the OAuth client used by Supabase)

- Authorized JavaScript origins: add `https://beathoven.io` (and `https://www.beathoven.io`).
- Authorized redirect URIs: keep only `https://<project-ref>.supabase.co/auth/v1/callback`. The app's own `/auth/callback` is allowlisted in Supabase, not Google.
- OAuth consent screen: set the app domain and homepage to `https://beathoven.io`, link the privacy policy under `/legal`, add `beathoven.io` as an authorized domain, and publish the app. While it's in Testing, only listed test users can sign in.

### 4. Cron

`vercel.json` schedules `GET /api/cron/uploads` daily at 05:00 UTC. Vercel sends `Authorization: Bearer $CRON_SECRET`; without `CRON_SECRET` set, the route returns 404 and nothing is cleaned. Hobby allows daily crons only and fires anywhere within the hour. Daily is enough for quarantine cleanup, the 30-day purge and queued file removal. Fingerprint retries (10 per run) only pick up submissions whose in-request fingerprinting failed. For a faster cadence, use Vercel Pro, or schedule it from Supabase with pg_cron + pg_net:

```sql
select vault.create_secret('<CRON_SECRET>', 'cron_secret');
select cron.schedule('upload-maintenance', '*/15 * * * *', $$
  select net.http_get(
    url := 'https://beathoven.io/api/cron/uploads',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    timeout_milliseconds := 60000
  );
$$);
```

### 5. Before launch

- Turn the dev bots off in the database (SQL editor): `update public.app_config set dev_tools_enabled = false;`. While it's on, any signed-in user can seat an existing bot through the `dev_add_bot` RPC.
- Loudness boost is off (`LOUDNESS_BOOST_ENABLED` in `src/lib/features.ts`). Flipping it back on restores the switch, playback gain and server-side measurement.

### Supabase free tier

500 MB database, 1 GB storage, 5 GB egress per month, 200 concurrent Realtime connections, 50k monthly active users, and the project pauses after a week without activity. Submissions are up to 50 MB and every listener streams every track, so storage and egress run out first. Watch Usage in the dashboard, or move to Pro before inviting a crowd. Vercel Hobby is for non-commercial use only.
