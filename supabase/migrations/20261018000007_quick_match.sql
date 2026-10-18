-- Room names, quick match, a richer public lobby list, joins blocked once a
-- game starts, room settings edits, public profiles and global presence.
--
-- Lock order (extends 20261018000002_state_machine.sql): quick-match mode
-- advisory lock, then the per-user membership lock, then rooms by ascending
-- id, then other tables. Only quick_match takes the mode lock, and nothing
-- that holds a user or room lock ever waits on it.

alter table public.rooms add column name text;

update public.rooms r
set name = coalesce((select p.username from public.profiles p where p.id = r.host_id) || '''s room', 'Room ' || r.code);

alter table public.rooms
  alter column name set not null,
  add constraint rooms_name_format check (char_length(name) between 1 and 40 and name = btrim(name));

create index rooms_quick_match_idx on public.rooms (mode, created_at) where status = 'lobby' and not is_private;

create function public._room_name(p_name text, p_uid uuid) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_name text := nullif(btrim(p_name), '');
begin
  if v_name is null then
    select username || '''s room' into v_name from public.profiles where id = p_uid;
  end if;
  if v_name is null or char_length(v_name) > 40 then
    raise exception using errcode = 'P0001', message = 'invalid_name';
  end if;
  return v_name;
end;
$$;

-- Caller holds the user lock.
create function public._create_room_locked(
  p_uid uuid,
  p_mode text,
  p_max_players integer,
  p_produce_seconds integer,
  p_vote_seconds integer,
  p_is_private boolean,
  p_name text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_previous uuid;
  v_name text;
begin
  if p_mode not in ('classic', 'premade', 'creative') then
    raise exception using errcode = 'P0001', message = 'invalid_mode';
  end if;
  if p_max_players not between 2 and 16
     or p_produce_seconds not between 60 and 7200
     or p_vote_seconds not between 5 and 120 then
    raise exception using errcode = 'P0001', message = 'invalid_settings';
  end if;
  if not exists (select 1 from public.profiles where id = p_uid) then
    raise exception using errcode = 'P0001', message = 'profile_missing';
  end if;
  v_name := public._room_name(p_name, p_uid);

  select room_id into v_previous from public.room_players where user_id = p_uid and left_at is null;
  if v_previous is not null then
    perform public._lock_room(v_previous);
    perform public._leave_room_locked(v_previous, p_uid);
    perform public._bump(v_previous);
  end if;

  for i in 1..20 loop
    insert into public.rooms (code, name, host_id, mode, max_players, produce_seconds, vote_seconds, is_private)
    values (public._generate_room_code(), v_name, p_uid, p_mode, p_max_players, p_produce_seconds, p_vote_seconds, p_is_private)
    on conflict (code) do nothing
    returning * into v_room;
    exit when v_room.id is not null;
  end loop;
  if v_room.id is null then
    raise exception using errcode = 'P0001', message = 'code_generation_failed';
  end if;

  insert into public.room_players (room_id, user_id) values (v_room.id, p_uid);
  return jsonb_build_object('room_id', v_room.id, 'code', v_room.code, 'version', v_room.version);
end;
$$;

-- Caller holds the user lock. Leaves the player's previous room (if any) and
-- joins this one. Only lobbies take new players; an active member "joining"
-- their own room mid-game is a no-op so reconnects keep working.
create function public._join_room_locked(p_uid uuid, p_room_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous uuid;
  v_lock_id uuid;
  r public.rooms;
begin
  select room_id into v_previous from public.room_players where user_id = p_uid and left_at is null;
  if v_previous = p_room_id then
    select * into r from public.rooms where id = p_room_id;
    return jsonb_build_object('room_id', r.id, 'code', r.code, 'version', r.version);
  end if;

  for v_lock_id in
    select id from unnest(array[p_room_id, v_previous]) as t(id) where id is not null order by id
  loop
    perform public._lock_room(v_lock_id);
  end loop;
  select * into r from public.rooms where id = p_room_id;

  if r.status = 'closed' then
    raise exception using errcode = 'P0001', message = 'room_closed';
  end if;
  if r.status <> 'lobby' then
    raise exception using errcode = 'P0001', message = 'room_in_progress';
  end if;
  if public._active_player_count(r.id) >= r.max_players then
    raise exception using errcode = 'P0001', message = 'room_full';
  end if;

  if v_previous is not null then
    perform public._leave_room_locked(v_previous, p_uid);
    perform public._bump(v_previous);
  end if;

  insert into public.room_players (room_id, user_id)
  values (r.id, p_uid)
  on conflict (room_id, user_id) do update
  set left_at = null, joined_at = now(), is_ready = false;

  return jsonb_build_object('room_id', r.id, 'code', r.code, 'version', public._bump(r.id));
end;
$$;

drop function public.create_room(text, integer, integer, integer, boolean);

create function public.create_room(
  p_mode text,
  p_max_players integer default 8,
  p_produce_seconds integer default 1200,
  p_vote_seconds integer default 20,
  p_is_private boolean default false,
  p_name text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
begin
  perform public._lock_user(v_uid);
  return public._create_room_locked(v_uid, p_mode, p_max_players, p_produce_seconds, p_vote_seconds, p_is_private, p_name);
end;
$$;

create or replace function public.join_room(p_code text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  v_room_id uuid;
begin
  perform public._lock_user(v_uid);
  select id into v_room_id from public.rooms where code = upper(btrim(p_code));
  if v_room_id is null then
    raise exception using errcode = 'P0001', message = 'room_not_found';
  end if;
  return public._join_room_locked(v_uid, v_room_id);
end;
$$;

-- Fills real lobbies instead of keeping a separate queue: join the fullest
-- (then oldest) open public lobby of the mode, or open one for others to land
-- in. The mode lock makes concurrent quick-matchers see each other's rooms.
create function public.quick_match(p_mode text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  v_candidate uuid;
begin
  if p_mode not in ('classic', 'premade', 'creative') then
    raise exception using errcode = 'P0001', message = 'invalid_mode';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('quick_match:' || p_mode, 0));
  perform public._lock_user(v_uid);

  for v_candidate in
    select r.id
    from public.rooms r
    cross join lateral (
      select count(*) as players, bool_or(rp.user_id = v_uid) as mine
      from public.room_players rp
      where rp.room_id = r.id and rp.left_at is null
    ) pc
    where r.mode = p_mode and r.status = 'lobby' and not r.is_private
      and (pc.players < r.max_players or pc.mine)
    order by pc.players desc, r.created_at, r.id
    limit 20
  loop
    begin
      return public._join_room_locked(v_uid, v_candidate) || jsonb_build_object('created', false);
    exception when sqlstate 'P0001' then
      -- The room filled up or started between the search and the lock.
      if sqlerrm not in ('room_full', 'room_closed', 'room_in_progress') then
        raise;
      end if;
    end;
  end loop;

  return public._create_room_locked(v_uid, p_mode, 8, 1200, 20, false, null) || jsonb_build_object('created', true);
end;
$$;

-- When the room should be back in the lobby. Exact-ish while listening
-- (remaining track lengths are known); during producing it assumes every
-- player submits a track as long as the average so far (or 3 minutes).
create function public._estimated_end_at(p_room public.rooms) returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case p_room.status
    when 'results' then p_room.phase_ends_at
    when 'listening' then p_room.phase_ends_at + interval '30 seconds' + coalesce((
      select sum(make_interval(secs => 3 + s.duration_ms / 1000.0 + p_room.vote_seconds))
      from unnest(p_room.track_order) with ordinality as t(id, ord)
      join public.submissions s on s.id = t.id
      where t.ord > p_room.current_track + 1
    ), interval '0')
    when 'producing' then p_room.phase_ends_at + interval '30 seconds' + (
      select make_interval(secs =>
        greatest(
          (select count(*) from public.room_players where room_id = p_room.id and left_at is null),
          count(*)
        ) * (3 + coalesce(avg(s.duration_ms) / 1000.0, 180) + p_room.vote_seconds)
      )
      from public.submissions s
      where s.room_id = p_room.id and s.round = p_room.round
    )
  end;
$$;

create or replace function public.list_public_rooms() returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x.room order by x.is_open desc, x.players desc, x.created_at), '[]'::jsonb)
  from (
    select r.status = 'lobby' as is_open, pc.players, r.created_at, jsonb_build_object(
      'id', r.id,
      'code', r.code,
      'name', r.name,
      'mode', r.mode,
      'status', r.status,
      'max_players', r.max_players,
      'player_count', pc.players,
      'host_username', p.username,
      'round', r.round,
      'phase_ends_at', r.phase_ends_at,
      'estimated_end_at', public._estimated_end_at(r),
      'joinable', r.status = 'lobby' and pc.players < r.max_players,
      'created_at', r.created_at
    ) as room
    from public.rooms r
    cross join lateral (
      select count(*)::integer as players from public.room_players rp where rp.room_id = r.id and rp.left_at is null
    ) pc
    left join public.profiles p on p.id = r.host_id
    where not r.is_private and r.status <> 'closed'
    order by r.status = 'lobby' desc, pc.players desc, r.created_at
    limit 100
  ) x;
$$;

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
      'status', r.status,
      'round', r.round,
      'phase_started_at', r.phase_started_at,
      'phase_ends_at', r.phase_ends_at,
      'track_order', to_jsonb(r.track_order),
      'current_track', r.current_track,
      'track_started_at', r.track_started_at
    ),
    'readiness', (
      -- The host is implicitly ready: pressing start is their ready.
      select jsonb_build_object(
        'ready', count(*) filter (where rp.is_ready or rp.user_id = r.host_id),
        'total', count(*),
        'all_ready', count(*) filter (where rp.is_ready or rp.user_id = r.host_id) = count(*),
        'can_start', count(*) >= 2 and count(*) filter (where rp.is_ready or rp.user_id = r.host_id) = count(*)
      )
      from public.room_players rp
      where rp.room_id = r.id and rp.left_at is null
    ),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', rp.user_id,
        'username', p.username,
        'avatar_url', p.avatar_url,
        'joined_at', rp.joined_at,
        'left_at', rp.left_at,
        'is_ready', rp.is_ready
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
    'submissions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'user_id', s.user_id,
        'storage_path', s.storage_path,
        'duration_ms', s.duration_ms,
        'submitted_at', s.submitted_at
      ) order by s.submitted_at)
      from public.submissions s
      where s.room_id = r.id and s.round = r.round
    ), '[]'::jsonb),
    'votes_cast', coalesce((
      select jsonb_agg(jsonb_build_object('submission_id', v.submission_id, 'voter_id', v.voter_id) order by v.id)
      from public.votes v
      where v.room_id = r.id and v.round = r.round
    ), '[]'::jsonb),
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

create function public.update_room_settings(
  p_room_id uuid,
  p_name text default null,
  p_max_players integer default null,
  p_produce_seconds integer default null,
  p_vote_seconds integer default null,
  p_is_private boolean default null,
  p_mode text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  r public.rooms := public._lock_room(p_room_id);
begin
  perform public._require_active_member(r.id, v_uid);
  if r.host_id is distinct from v_uid then
    raise exception using errcode = 'P0001', message = 'not_host';
  end if;
  if r.status <> 'lobby' then
    raise exception using errcode = 'P0001', message = 'wrong_phase';
  end if;
  if p_mode is not null and p_mode not in ('classic', 'premade', 'creative') then
    raise exception using errcode = 'P0001', message = 'invalid_mode';
  end if;
  if p_max_players not between 2 and 16
     or p_produce_seconds not between 60 and 7200
     or p_vote_seconds not between 5 and 120 then
    raise exception using errcode = 'P0001', message = 'invalid_settings';
  end if;
  if p_max_players < public._active_player_count(r.id) then
    raise exception using errcode = 'P0001', message = 'max_players_below_count';
  end if;

  update public.rooms
  set name = case when p_name is null then name else public._room_name(p_name, v_uid) end,
      max_players = coalesce(p_max_players, max_players),
      produce_seconds = coalesce(p_produce_seconds, produce_seconds),
      vote_seconds = coalesce(p_vote_seconds, vote_seconds),
      is_private = coalesce(p_is_private, is_private),
      mode = coalesce(p_mode, mode)
  where id = r.id;

  -- Players readied up for different rules; cosmetic changes keep ready.
  if p_mode is distinct from r.mode and p_mode is not null
     or p_produce_seconds is distinct from r.produce_seconds and p_produce_seconds is not null
     or p_vote_seconds is distinct from r.vote_seconds and p_vote_seconds is not null then
    update public.room_players set is_ready = false
    where room_id = r.id and user_id <> v_uid and is_ready;
  end if;

  perform public._bump(r.id);
end;
$$;

alter table public.round_results add column finished_at timestamptz not null default now();

-- Public profile page: only fields already visible to anyone, plus finished
-- round results. Private rooms' names are withheld.
create function public.get_profile(p_username text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
begin
  select * into v_profile from public.profiles where lower(username) = lower(btrim(p_username));
  if v_profile.id is null then
    raise exception using errcode = 'P0001', message = 'profile_not_found';
  end if;

  return jsonb_build_object(
    'profile', jsonb_build_object(
      'id', v_profile.id,
      'username', v_profile.username,
      'avatar_url', v_profile.avatar_url,
      'bio', v_profile.bio,
      'wins', v_profile.wins,
      'ties', v_profile.ties,
      'games_played', v_profile.games_played,
      'created_at', v_profile.created_at
    ),
    'recent_results', coalesce((
      select jsonb_agg(x.result order by x.finished_at desc)
      from (
        select rr.finished_at, jsonb_build_object(
          'room_name', case when r.is_private then null else r.name end,
          'mode', r.mode,
          'round', rr.round,
          'avg_score', rr.avg_score,
          'vote_count', rr.vote_count,
          'rank', rr.rank,
          'entrants', (
            select count(*) from public.round_results o where o.room_id = rr.room_id and o.round = rr.round
          ),
          'is_winner', rr.is_winner,
          'finished_at', rr.finished_at
        ) as result
        from public.round_results rr
        join public.rooms r on r.id = rr.room_id
        where rr.user_id = v_profile.id
        order by rr.finished_at desc
        limit 20
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

-- App-wide Presence channel for the online-user count. Read covers the join
-- check for both extensions; clients may only publish Presence, never Broadcast.
create policy "authenticated read online topic" on realtime.messages
for select to authenticated
using (
  realtime.messages.extension in ('presence', 'broadcast')
  and (select realtime.topic()) = 'online'
);

create policy "authenticated track presence on online topic" on realtime.messages
for insert to authenticated
with check (
  realtime.messages.extension = 'presence'
  and (select realtime.topic()) = 'online'
);

revoke execute on function
  public._room_name(text, uuid),
  public._create_room_locked(uuid, text, integer, integer, integer, boolean, text),
  public._join_room_locked(uuid, uuid),
  public._estimated_end_at(public.rooms)
from public, anon, authenticated;

revoke execute on function
  public.create_room(text, integer, integer, integer, boolean, text),
  public.quick_match(text),
  public.update_room_settings(uuid, text, integer, integer, integer, boolean, text),
  public.get_profile(text)
from public, anon;

grant execute on function
  public.create_room(text, integer, integer, integer, boolean, text),
  public.quick_match(text),
  public.update_room_settings(uuid, text, integer, integer, integer, boolean, text)
to authenticated;

grant execute on function public.get_profile(text) to anon, authenticated;
