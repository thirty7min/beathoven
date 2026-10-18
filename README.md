# Beat Battle

Multiplayer beat battles: Next.js (App Router) + Supabase (Postgres, Auth, Realtime, Storage).

## Setup

1. `pnpm install`
2. Copy `.env.example` to `.env.local` and fill in the values from your Supabase project.
3. `supabase link --project-ref <ref>` then `supabase db push` to apply `supabase/migrations`.
4. In the Supabase dashboard:
   - Auth: enable anonymous sign-ins (guests play without an account).
   - Realtime settings: disable "Allow public access" so room channels are private-only.
   - Database extensions: pg_cron should be available; the cron migration schedules `public.sweep_rooms()` every 5 seconds.

## Scripts

- `pnpm dev`: start Next.js
- `pnpm typecheck`: generate route types and run `tsc`
- `pnpm lint`
- `pnpm test`: unit tests plus the SQL state machine tests, which run the migrations in PGlite against stubbed `auth`, `realtime` and `storage` schemas (`supabase/tests/stubs.sql`)

## How room state works

- Postgres is authoritative. Clients change game state only through the SECURITY DEFINER RPCs in `supabase/migrations/*_state_machine.sql`.
- Every state change bumps `rooms.version`, and a deferred trigger broadcasts the full public room state to the private topic `room:<room_id>`.
- `src/lib/game/room-connection.ts` fetches a snapshot, subscribes to the room topic and Presence, drops stale versions, and refetches on reconnect, tab wake or a version gap. Any member's client calls `advance_room` once a deadline passes, and pg_cron sweeps rooms nobody is watching.
