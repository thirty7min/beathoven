-- Dev-only bots for solo testing. Off unless app_config.dev_tools_enabled is
-- true (default false; only the service role can flip it), and the API route
-- that creates bot accounts also requires ENABLE_DEV_TOOLS=true outside
-- production.
--
-- A bot is an ordinary auth user (created by the route via the Admin API)
-- with profiles.is_bot set and a row in dev_bots holding its placeholder
-- track. Bots join through the normal join logic, so the one-lobby rule, seat
-- limits and phase checks all apply. Their behaviour lives in triggers that
-- no-op while the gate is off:
--   * always ready (room_players before insert/update);
--   * kept fresh while any human in the room heartbeats, so they count toward
--     readiness and "everyone submitted/voted" like a live player; with the
--     gate off they go stale and the lobby sweep removes them;
--   * submit their placeholder the moment producing starts;
--   * rate every other entry 1-5 at random as each track starts;
--   * never vote to skip.
-- A bot never becomes host, and once the last human leaves the bots leave
-- too, which closes the room. Bots get no wins/ties/games_played.
--
-- Placeholder audio: each bot has one WAV at `bots/<random uuid>.wav` in the
-- submissions bucket, uploaded once by the route with the service role. Every
-- bot submission points at it; can_read_submission already grants reads to
-- anyone who can see a submission row with that path, so storage policies
-- are unchanged.
--
-- Lock order: dev_bots row, then the usual user lock and rooms by id.

create table public.app_config (
  id boolean primary key default true constraint app_config_singleton check (id),
  dev_tools_enabled boolean not null default false
);

insert into public.app_config default values;

alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated;

alter table public.profiles add column is_bot boolean not null default false;

create table public.dev_bots (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  number integer not null unique,
  storage_path text not null,
  duration_ms integer not null check (duration_ms between 1000 and 600000),
  created_at timestamptz not null default now()
);

alter table public.dev_bots enable row level security;
revoke all on public.dev_bots from anon, authenticated;

create function public.dev_tools_enabled() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select dev_tools_enabled from public.app_config), false);
$$;

create function public._require_dev_tools() returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.dev_tools_enabled() then
    raise exception using errcode = 'P0001', message = 'dev_tools_disabled';
  end if;
end;
$$;

create function public._is_bot(p_uid uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select is_bot from public.profiles where id = p_uid), false);
$$;

-- Room state -----------------------------------------------------------------

-- Same as 20261018000008 plus players[].is_bot.
create or replace function public._room_state(p_room_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'version', r.version,
    'room', jsonb_build_object(
      'id', r.id,
      'code', r.code,
      'name', r.name,
      'host_id', r.host_id,
      'mode', r.mode,
      'max_players', r.max_players,
      'produce_seconds', r.produce_seconds,
      'vote_seconds', r.vote_seconds,
      'is_private', r.is_private,
      'reveal_names', r.reveal_names,
      'listen_seconds', r.listen_seconds,
      'status', r.status,
      'round', r.round,
      'phase_started_at', r.phase_started_at,
      'phase_ends_at', r.phase_ends_at,
      'track_order', to_jsonb(r.track_order),
      'current_track', r.current_track,
      'track_started_at', r.track_started_at
    ),
    'readiness', (
      -- The host is implicitly ready: pressing start is their ready. Stale
      -- members don't count.
      select jsonb_build_object(
        'ready', count(*) filter (where rp.is_ready or rp.user_id = r.host_id),
        'total', count(*),
        'all_ready', count(*) filter (where rp.is_ready or rp.user_id = r.host_id) = count(*),
        'can_start', count(*) >= 2 and count(*) filter (where rp.is_ready or rp.user_id = r.host_id) = count(*)
      )
      from public.room_players rp
      where rp.room_id = r.id and rp.left_at is null and rp.last_seen_at > public._fresh_cutoff()
    ),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', rp.user_id,
        'username', p.username,
        'avatar_url', p.avatar_url,
        'joined_at', rp.joined_at,
        'left_at', rp.left_at,
        'last_seen_at', rp.last_seen_at,
        'is_ready', rp.is_ready,
        'is_bot', p.is_bot
      ) order by rp.joined_at, rp.user_id)
      from public.room_players rp
      join public.profiles p on p.id = rp.user_id
      where rp.room_id = r.id
    ), '[]'::jsonb),
    'assets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', a.kind,
        'position', a.position,
        'prompt', pr.body,
        'sample', case when sa.id is null then null else jsonb_build_object(
          'id', sa.id,
          'name', sa.name,
          'storage_path', sa.storage_path,
          'category', sa.category,
          'bpm', sa.bpm,
          'musical_key', sa.musical_key,
          'duration_ms', sa.duration_ms
        ) end
      ) order by a.position)
      from public.room_assets a
      left join public.prompts pr on pr.id = a.prompt_id
      left join public.samples sa on sa.id = a.sample_id
      where a.room_id = r.id and a.round = r.round
    ), '[]'::jsonb),
    'submissions', case
      when r.status = 'producing' then '[]'::jsonb
      when r.status = 'listening' then coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', s.id,
          'user_id', case when r.reveal_names and t.ord <= r.current_track + 1 then s.user_id end,
          'storage_path', s.storage_path,
          'duration_ms', s.duration_ms,
          'submitted_at', null
        ) order by t.ord)
        from unnest(r.track_order) with ordinality as t(id, ord)
        join public.submissions s on s.id = t.id
      ), '[]'::jsonb)
      else coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', s.id,
          'user_id', s.user_id,
          'storage_path', s.storage_path,
          'duration_ms', s.duration_ms,
          'submitted_at', s.submitted_at
        ) order by s.submitted_at)
        from public.submissions s
        where s.room_id = r.id and s.round = r.round
      ), '[]'::jsonb)
    end,
    'submitted_user_ids', coalesce((
      select jsonb_agg(s.user_id order by s.user_id)
      from public.submissions s
      where s.room_id = r.id and s.round = r.round
    ), '[]'::jsonb),
    'votes_cast', case
      when r.status = 'listening' and not r.reveal_names then '[]'::jsonb
      else coalesce((
        select jsonb_agg(jsonb_build_object('submission_id', v.submission_id, 'voter_id', v.voter_id) order by v.id)
        from public.votes v
        where v.room_id = r.id and v.round = r.round
      ), '[]'::jsonb)
    end,
    -- Aggregate only: in blind rooms a per-user list would expose the producer
    -- (the one eligible member who never votes).
    'current_votes', case when r.status = 'listening' then (
      select jsonb_build_object(
        'submission_id', cur.id,
        'count', (
          select count(*) from public.votes v
          where v.submission_id = cur.id and v.voter_id in (select public._eligible_voters(r))
        ),
        'eligible', (select count(*) from public._eligible_voters(r))
      ) || case when r.reveal_names then jsonb_build_object('voted_user_ids', coalesce((
        select jsonb_agg(v.voter_id order by v.id) from public.votes v where v.submission_id = cur.id
      ), '[]'::jsonb)) else '{}'::jsonb end
      from public._current_submission(r) cur
    ) end,
    'skip', case when r.status = 'listening' then (
      select jsonb_build_object('submission_id', cur.id, 'votes', c.votes, 'needed', c.needed)
      from public._current_submission(r) cur, public._skip_counts(r) c
    ) end,
    'results', coalesce((
      select jsonb_agg(jsonb_build_object(
        'submission_id', rr.submission_id,
        'user_id', rr.user_id,
        'avg_score', rr.avg_score,
        'vote_count', rr.vote_count,
        'rank', rr.rank,
        'is_winner', rr.is_winner
      ) order by rr.rank, rr.user_id)
      from public.round_results rr
      where rr.room_id = r.id and rr.round = r.round
    ), '[]'::jsonb)
  )
  from public.rooms r
  where r.id = p_room_id;
$$;

-- Bots never earn stats; otherwise identical to 20261018000008.
create or replace function public._enter_results(p_room_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.rooms;
  v_winner_count integer;
begin
  select * into r from public.rooms where id = p_room_id;

  -- Averages are rounded to 4 places so equal fractions compare equal
  -- regardless of numeric scale; distinct averages over <= 16 voters always
  -- differ by more than that.
  insert into public.round_results (room_id, round, submission_id, user_id, avg_score, vote_count, rank, is_winner)
  select r.id, r.round, s.id, s.user_id, s.avg_score, s.vote_count,
         rank() over (order by s.avg_score desc nulls last),
         s.avg_score is not null and s.avg_score = max(s.avg_score) over ()
  from (
    select sub.id, sub.user_id, count(v.id)::integer as vote_count, round(avg(v.score)::numeric, 4) as avg_score
    from public.submissions sub
    left join public.votes v on v.submission_id = sub.id
    where sub.room_id = r.id and sub.round = r.round
    group by sub.id, sub.user_id
  ) s
  on conflict do nothing;

  select count(*) into v_winner_count
  from public.round_results where room_id = r.id and round = r.round and is_winner;

  perform 1 from public.profiles
  where id in (select user_id from public.round_results where room_id = r.id and round = r.round)
    and not is_bot
  order by id
  for update;

  update public.profiles p
  set games_played = p.games_played + 1,
      wins = p.wins + case when rr.is_winner and v_winner_count = 1 then 1 else 0 end,
      ties = p.ties + case when rr.is_winner and v_winner_count > 1 then 1 else 0 end
  from public.round_results rr
  where rr.room_id = r.id and rr.round = r.round and rr.user_id = p.id and not p.is_bot;

  update public.rooms
  set status = 'results',
      current_track = null,
      track_started_at = null,
      phase_started_at = now(),
      phase_ends_at = now() + interval '30 seconds'
  where id = p_room_id;
end;
$$;

-- Humans are preferred as the next host, and when no human is left the bots
-- leave with them so the room closes. Otherwise identical to
-- 20261018000002.
create or replace function public._leave_room_locked(p_room_id uuid, p_uid uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.rooms;
  v_next_host uuid;
begin
  select * into r from public.rooms where id = p_room_id;

  update public.room_players set left_at = now(), is_ready = false
  where room_id = r.id and user_id = p_uid;

  if not exists (
    select 1 from public.room_players rp
    join public.profiles p on p.id = rp.user_id
    where rp.room_id = r.id and rp.left_at is null and not p.is_bot
  ) then
    update public.room_players set left_at = now(), is_ready = false
    where room_id = r.id and left_at is null;
  end if;

  if r.host_id is not distinct from p_uid then
    select rp.user_id into v_next_host
    from public.room_players rp
    join public.profiles p on p.id = rp.user_id
    where rp.room_id = r.id and rp.left_at is null
    order by p.is_bot, rp.joined_at, rp.user_id
    limit 1;
    if v_next_host is not null then
      update public.rooms set host_id = v_next_host where id = r.id;
    end if;
  end if;

  if public._active_player_count(r.id) = 0 then
    update public.rooms
    set status = 'closed', phase_ends_at = null, current_track = null, track_started_at = null
    where id = r.id;
  else
    perform public._advance_step(r.id);
  end if;
end;
$$;

-- Bot behaviour ----------------------------------------------------------------

create function public._dev_bot_ready() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public._is_bot(new.user_id) and public.dev_tools_enabled() then
    new.is_ready := true;
  end if;
  return new;
end;
$$;

create trigger room_players_dev_bot_ready
before insert or update on public.room_players
for each row
when (new.left_at is null)
execute function public._dev_bot_ready();

-- Skip locked: concurrent heartbeats in one room never wait on each other;
-- whichever holds a bot row is refreshing it already.
create function public._dev_refresh_bots() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.dev_tools_enabled() or public._is_bot(new.user_id) then
    return null;
  end if;
  update public.room_players rp
  set last_seen_at = now()
  where (rp.room_id, rp.user_id) in (
    select b.room_id, b.user_id
    from public.room_players b
    join public.profiles p on p.id = b.user_id
    where b.room_id = new.room_id and b.left_at is null and p.is_bot
      and b.last_seen_at < now() - interval '15 seconds'
    for update of b skip locked
  );
  return null;
end;
$$;

create trigger room_players_dev_refresh_bots
after update of last_seen_at on public.room_players
for each row
when (new.left_at is null)
execute function public._dev_refresh_bots();

create function public._dev_bots_act() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.dev_tools_enabled() then
    return null;
  end if;

  if new.status = 'producing' then
    insert into public.submissions (room_id, round, user_id, storage_path, duration_ms)
    select new.id, new.round, b.user_id, b.storage_path, b.duration_ms
    from public.room_players rp
    join public.dev_bots b on b.user_id = rp.user_id
    where rp.room_id = new.id and rp.left_at is null
    on conflict (room_id, round, user_id) do nothing;
  elsif new.status = 'listening' and new.current_track is not null then
    insert into public.votes (room_id, round, submission_id, voter_id, score)
    select new.id, new.round, s.id, b.user_id, 1 + floor(random() * 5)::integer
    from public._current_submission(new) s
    join public.room_players rp on rp.room_id = new.id and rp.left_at is null and rp.user_id <> s.user_id
    join public.dev_bots b on b.user_id = rp.user_id
    where s.id is not null
    on conflict (submission_id, voter_id) do nothing;
  end if;
  return null;
end;
$$;

create trigger rooms_dev_bots_act
after update of status, current_track on public.rooms
for each row
when (old.status is distinct from new.status or old.current_track is distinct from new.current_track)
execute function public._dev_bots_act();

-- RPCs -------------------------------------------------------------------------

-- Service role only: turns a fresh auth user into the next numbered bot once
-- its placeholder track is uploaded.
create function public.dev_register_bot(p_user_id uuid, p_storage_path text, p_duration_ms integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number integer;
  v_username text;
begin
  perform public._require_dev_tools();
  if p_storage_path !~ '^bots/[A-Za-z0-9_-]+\.wav$' then
    raise exception using errcode = 'P0001', message = 'invalid_path';
  end if;
  if p_duration_ms is null or p_duration_ms not between 1000 and 600000 then
    raise exception using errcode = 'P0001', message = 'invalid_duration';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('dev_register_bot', 0));

  v_number := coalesce((select max(number) from public.dev_bots), 0) + 1;
  while exists (select 1 from public.profiles where lower(username) = lower('Bot_' || v_number)) loop
    v_number := v_number + 1;
  end loop;
  v_username := 'Bot_' || v_number;

  update public.profiles set is_bot = true, username = v_username where id = p_user_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'profile_not_found';
  end if;
  insert into public.dev_bots (user_id, number, storage_path, duration_ms)
  values (p_user_id, v_number, p_storage_path, p_duration_ms);

  return jsonb_build_object('user_id', p_user_id, 'username', v_username);
end;
$$;

-- Host only, lobby only. Seats an idle bot through the normal join logic, or
-- raises no_idle_bot so the caller can register another one.
create function public.dev_add_bot(p_room_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  r public.rooms;
  v_bot uuid;
begin
  perform public._require_dev_tools();
  select * into r from public.rooms where id = p_room_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'room_not_found';
  end if;
  if r.host_id is distinct from v_uid then
    raise exception using errcode = 'P0001', message = 'not_host';
  end if;
  if r.status <> 'lobby' then
    raise exception using errcode = 'P0001', message = 'wrong_phase';
  end if;

  select b.user_id into v_bot
  from public.dev_bots b
  where not exists (select 1 from public.room_players rp where rp.user_id = b.user_id and rp.left_at is null)
  order by b.number
  limit 1
  for update skip locked;
  if v_bot is null then
    raise exception using errcode = 'P0001', message = 'no_idle_bot';
  end if;

  perform public._lock_user(v_bot);
  if exists (select 1 from public.room_players where user_id = v_bot and left_at is null) then
    raise exception using errcode = 'P0001', message = 'no_idle_bot';
  end if;
  perform public._join_room_locked(v_bot, p_room_id);

  -- Re-checked under the room lock taken by the join.
  perform public._require_active_member(p_room_id, v_uid);
  if (select host_id from public.rooms where id = p_room_id) is distinct from v_uid then
    raise exception using errcode = 'P0001', message = 'not_host';
  end if;

  return jsonb_build_object('user_id', v_bot, 'username', (select username from public.profiles where id = v_bot));
end;
$$;

create function public.dev_remove_bot(p_room_id uuid, p_bot_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  r public.rooms;
begin
  perform public._require_dev_tools();
  if not public._is_bot(p_bot_id) then
    raise exception using errcode = 'P0001', message = 'not_a_bot';
  end if;
  perform public._lock_user(p_bot_id);
  r := public._lock_room(p_room_id);
  perform public._require_active_member(r.id, v_uid);
  if r.host_id is distinct from v_uid then
    raise exception using errcode = 'P0001', message = 'not_host';
  end if;
  if not exists (select 1 from public.room_players where room_id = r.id and user_id = p_bot_id and left_at is null) then
    raise exception using errcode = 'P0001', message = 'not_member';
  end if;
  perform public._leave_room_locked(r.id, p_bot_id);
  perform public._bump(r.id);
end;
$$;

-- Grants -----------------------------------------------------------------------

revoke execute on function
  public._require_dev_tools(),
  public._is_bot(uuid),
  public._dev_bot_ready(),
  public._dev_refresh_bots(),
  public._dev_bots_act(),
  public.dev_register_bot(uuid, text, integer)
from public, anon, authenticated;

grant execute on function public.dev_register_bot(uuid, text, integer) to service_role;

revoke execute on function
  public.dev_tools_enabled(),
  public.dev_add_bot(uuid),
  public.dev_remove_bot(uuid, uuid)
from public, anon;

grant execute on function
  public.dev_tools_enabled(),
  public.dev_add_bot(uuid),
  public.dev_remove_bot(uuid, uuid)
to authenticated;
