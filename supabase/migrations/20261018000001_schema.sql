-- Core schema. Clients read through RLS; every game mutation goes through the
-- SECURITY DEFINER RPCs in the state machine migration, so no table grants
-- insert/update/delete to clients except the editable profile columns.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  avatar_url text,
  bio text not null default '',
  wins integer not null default 0,
  ties integer not null default 0,
  games_played integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[A-Za-z0-9_]{3,24}$'),
  constraint profiles_bio_length check (char_length(bio) <= 500)
);

create unique index profiles_username_lower_key on public.profiles (lower(username));

create table public.prompts (
  id bigint generated always as identity primary key,
  body text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.samples (
  id bigint generated always as identity primary key,
  name text not null,
  storage_path text not null unique,
  category text not null check (category in ('kick', 'snare', 'hihat', 'clap', 'perc', '808', 'synth', 'melody', 'loop', 'vocal', 'fx')),
  bpm integer check (bpm between 20 and 400),
  musical_key text,
  duration_ms integer check (duration_ms > 0),
  license text not null default 'royalty-free',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index samples_active_category_idx on public.samples (category) where active;

-- How many samples of each category a classic round hands out. Edit rows to
-- change the recipe; categories without a row are never picked.
create table public.sample_recipe (
  category text primary key check (category in ('kick', 'snare', 'hihat', 'clap', 'perc', '808', 'synth', 'melody', 'loop', 'vocal', 'fx')),
  count integer not null check (count between 0 and 16),
  position integer not null default 0
);

insert into public.sample_recipe (category, count, position) values
  ('kick', 1, 0),
  ('snare', 1, 1),
  ('hihat', 1, 2),
  ('808', 1, 3),
  ('synth', 3, 4),
  ('perc', 1, 5);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  host_id uuid references public.profiles (id) on delete set null,
  mode text not null check (mode in ('classic', 'premade', 'creative')),
  max_players integer not null default 8 check (max_players between 2 and 16),
  produce_seconds integer not null default 1200 check (produce_seconds between 60 and 7200),
  vote_seconds integer not null default 20 check (vote_seconds between 5 and 120),
  is_private boolean not null default false,
  status text not null default 'lobby' check (status in ('lobby', 'producing', 'listening', 'results', 'closed')),
  round integer not null default 0,
  phase_started_at timestamptz not null default now(),
  phase_ends_at timestamptz,
  track_order uuid[] not null default '{}',
  current_track integer,
  track_started_at timestamptz,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index rooms_sweep_idx on public.rooms (phase_ends_at) where status in ('producing', 'listening', 'results');
create index rooms_public_lobby_idx on public.rooms (created_at desc) where status <> 'closed' and not is_private;

create table public.room_players (
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  is_ready boolean not null default false,
  primary key (room_id, user_id)
);

-- One active room per player.
create unique index room_players_one_active_room on public.room_players (user_id) where left_at is null;

create table public.room_assets (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms (id) on delete cascade,
  round integer not null,
  kind text not null check (kind in ('sample', 'prompt')),
  sample_id bigint references public.samples (id),
  prompt_id bigint references public.prompts (id),
  position integer not null default 0,
  constraint room_assets_kind_ref check (
    (kind = 'sample' and sample_id is not null and prompt_id is null)
    or (kind = 'prompt' and prompt_id is not null and sample_id is null)
  )
);

create index room_assets_room_round_idx on public.room_assets (room_id, round);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  round integer not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  storage_path text not null,
  duration_ms integer not null check (duration_ms between 1000 and 600000),
  submitted_at timestamptz not null default now(),
  unique (room_id, round, user_id)
);

create table public.votes (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms (id) on delete cascade,
  round integer not null,
  submission_id uuid not null references public.submissions (id) on delete cascade,
  voter_id uuid not null references public.profiles (id) on delete cascade,
  score smallint not null check (score between 1 and 5),
  created_at timestamptz not null default now(),
  unique (submission_id, voter_id)
);

create index votes_room_round_idx on public.votes (room_id, round);

create function public.votes_reject_self_vote() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.submissions s where s.id = new.submission_id and s.user_id = new.voter_id) then
    raise exception using errcode = 'P0001', message = 'self_vote';
  end if;
  return new;
end;
$$;

create trigger votes_reject_self_vote
before insert or update on public.votes
for each row execute function public.votes_reject_self_vote();

create table public.round_results (
  room_id uuid not null references public.rooms (id) on delete cascade,
  round integer not null,
  submission_id uuid not null references public.submissions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  avg_score numeric(6, 4),
  vote_count integer not null,
  rank integer not null,
  is_winner boolean not null,
  primary key (room_id, round, submission_id)
);

create table public.chat_messages (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create index chat_messages_room_idx on public.chat_messages (room_id, id desc);

-- Profiles are created for every auth user (including anonymous sign-ins).
create function public.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, 'producer_' || substr(replace(new.id::text, '-', ''), 1, 10));
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create function public.touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
for each row execute function public.touch_updated_at();

create trigger rooms_touch before update on public.rooms
for each row execute function public.touch_updated_at();

-- Membership helpers are SECURITY DEFINER so RLS policies can call them
-- without recursing into room_players' own policies.
create function public.is_room_member(p_room_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.room_players rp
    where rp.room_id = p_room_id and rp.user_id = auth.uid()
  );
$$;

create function public.is_active_room_member(p_room_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.room_players rp
    where rp.room_id = p_room_id and rp.user_id = auth.uid() and rp.left_at is null
  );
$$;

alter table public.profiles enable row level security;
alter table public.prompts enable row level security;
alter table public.samples enable row level security;
alter table public.sample_recipe enable row level security;
alter table public.rooms enable row level security;
alter table public.room_players enable row level security;
alter table public.room_assets enable row level security;
alter table public.submissions enable row level security;
alter table public.votes enable row level security;
alter table public.round_results enable row level security;
alter table public.chat_messages enable row level security;

revoke all on public.profiles, public.prompts, public.samples, public.sample_recipe, public.rooms, public.room_players,
  public.room_assets, public.submissions, public.votes, public.round_results, public.chat_messages
  from anon, authenticated;

grant select on public.profiles to anon, authenticated;
grant update (username, avatar_url, bio) on public.profiles to authenticated;
grant select on public.prompts, public.samples, public.sample_recipe, public.rooms, public.room_players, public.room_assets,
  public.submissions, public.votes, public.round_results, public.chat_messages
  to authenticated;

create policy "profiles are public" on public.profiles
for select to anon, authenticated using (true);

create policy "users edit own profile" on public.profiles
for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy "prompts readable" on public.prompts
for select to authenticated using (active);

create policy "samples readable" on public.samples
for select to authenticated using (active);

create policy "sample recipe readable" on public.sample_recipe
for select to authenticated using (true);

create policy "rooms visible to members or when public" on public.rooms
for select to authenticated
using ((not is_private and status <> 'closed') or public.is_room_member(id));

create policy "players visible to room members" on public.room_players
for select to authenticated
using (public.is_room_member(room_id));

create policy "assets visible to room members" on public.room_assets
for select to authenticated
using (public.is_room_member(room_id));

create policy "submissions visible to room members" on public.submissions
for select to authenticated
using (public.is_room_member(room_id));

create policy "voters see own votes" on public.votes
for select to authenticated
using (voter_id = (select auth.uid()));

create policy "results visible to room members" on public.round_results
for select to authenticated
using (public.is_room_member(room_id));

create policy "chat visible to room members" on public.chat_messages
for select to authenticated
using (public.is_room_member(room_id));

revoke execute on function public.is_room_member(uuid), public.is_active_room_member(uuid) from public, anon;
grant execute on function public.is_room_member(uuid), public.is_active_room_member(uuid) to authenticated;
revoke execute on function public.handle_new_user(), public.touch_updated_at(), public.votes_reject_self_vote() from public, anon, authenticated;
