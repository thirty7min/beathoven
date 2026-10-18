-- Room state machine: lobby -> producing -> listening -> results -> lobby.
--
-- Concurrency: every mutating RPC locks the room row (select ... for update)
-- before touching any other room table, so actions on one room are fully
-- serialized. RPCs that change a player's membership (create/join/leave) first
-- take a per-user advisory lock, then lock rooms in ascending id order. Lock
-- order is always: user, then rooms by id, then other tables. Each public RPC
-- bumps the version of every room it changed exactly once, after its changes.

create function public._lock_room(p_room_id uuid) returns public.rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'room_not_found';
  end if;
  return r;
end;
$$;

create function public._lock_user(p_uid uuid) returns void
language sql
security definer
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('room_membership:' || p_uid::text, 0));
$$;

create function public._require_uid() returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'not_authenticated';
  end if;
  return v_uid;
end;
$$;

create function public._require_active_member(p_room_id uuid, p_uid uuid) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.room_players
    where room_id = p_room_id and user_id = p_uid and left_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'not_member';
  end if;
end;
$$;

create function public._active_player_count(p_room_id uuid) returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.room_players where room_id = p_room_id and left_at is null;
$$;

create function public._bump(p_room_id uuid) returns bigint
language sql
security definer
set search_path = ''
as $$
  update public.rooms set version = version + 1 where id = p_room_id returning version;
$$;

create function public._current_submission(p_room public.rooms) returns public.submissions
language sql
stable
security definer
set search_path = ''
as $$
  select s.* from public.submissions s
  where p_room.current_track is not null
    and s.id = p_room.track_order[p_room.current_track + 1];
$$;

create function public._all_submitted(p_room public.rooms) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.room_players where room_id = p_room.id and left_at is null)
    and not exists (
      select 1 from public.room_players rp
      where rp.room_id = p_room.id and rp.left_at is null
        and not exists (
          select 1 from public.submissions s
          where s.room_id = p_room.id and s.round = p_room.round and s.user_id = rp.user_id
        )
    );
$$;

-- Everyone active except the track's producer has voted on the current track.
create function public._all_voted(p_room public.rooms) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with cur as (select * from public._current_submission(p_room))
  select exists (select 1 from cur where id is not null)
    and not exists (
      select 1 from public.room_players rp, cur
      where rp.room_id = p_room.id and rp.left_at is null and rp.user_id <> cur.user_id
        and not exists (
          select 1 from public.votes v where v.submission_id = cur.id and v.voter_id = rp.user_id
        )
    );
$$;

create function public._start_track(p_room_id uuid, p_index integer) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.rooms;
  v_duration_ms integer;
  v_starts_at timestamptz := now() + interval '3 seconds';
begin
  select * into r from public.rooms where id = p_room_id;
  select duration_ms into v_duration_ms from public.submissions where id = r.track_order[p_index + 1];
  update public.rooms
  set status = 'listening',
      current_track = p_index,
      track_started_at = v_starts_at,
      phase_started_at = now(),
      phase_ends_at = v_starts_at + make_interval(secs => v_duration_ms / 1000.0 + r.vote_seconds)
  where id = p_room_id;
end;
$$;

create function public._enter_results(p_room_id uuid) returns void
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

  update public.profiles p
  set games_played = p.games_played + 1,
      wins = p.wins + case when rr.is_winner and v_winner_count = 1 then 1 else 0 end,
      ties = p.ties + case when rr.is_winner and v_winner_count > 1 then 1 else 0 end
  from public.round_results rr
  where rr.room_id = r.id and rr.round = r.round and rr.user_id = p.id;

  update public.rooms
  set status = 'results',
      current_track = null,
      track_started_at = null,
      phase_started_at = now(),
      phase_ends_at = now() + interval '30 seconds'
  where id = p_room_id;
end;
$$;

create function public._return_to_lobby(p_room_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.room_players set is_ready = false where room_id = p_room_id;
  update public.rooms
  set status = 'lobby',
      track_order = '{}',
      current_track = null,
      track_started_at = null,
      phase_started_at = now(),
      phase_ends_at = null
  where id = p_room_id;
end;
$$;

-- Performs at most one transition if it is due. Caller must hold the room lock
-- and bump the version when this returns true.
create function public._advance_step(p_room_id uuid) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.rooms;
  v_order uuid[];
  v_track_ends_at timestamptz;
begin
  select * into r from public.rooms where id = p_room_id;

  if r.status = 'producing' then
    if now() < r.phase_ends_at and not public._all_submitted(r) then
      return false;
    end if;
    select coalesce(array_agg(id order by random()), '{}') into v_order
    from public.submissions where room_id = r.id and round = r.round;
    if cardinality(v_order) = 0 then
      perform public._enter_results(r.id);
    else
      update public.rooms set track_order = v_order where id = r.id;
      perform public._start_track(r.id, 0);
    end if;
    return true;
  end if;

  if r.status = 'listening' then
    if now() < r.phase_ends_at then
      if not public._all_voted(r) then
        return false;
      end if;
      -- Everyone has voted: skip the rest of the vote window, but never cut
      -- the track itself short.
      select r.track_started_at + make_interval(secs => s.duration_ms / 1000.0) into v_track_ends_at
      from public._current_submission(r) s;
      if now() < v_track_ends_at then
        if r.phase_ends_at > v_track_ends_at then
          update public.rooms set phase_ends_at = v_track_ends_at where id = r.id;
          return true;
        end if;
        return false;
      end if;
    end if;
    if r.current_track + 1 < cardinality(r.track_order) then
      perform public._start_track(r.id, r.current_track + 1);
    else
      perform public._enter_results(r.id);
    end if;
    return true;
  end if;

  if r.status = 'results' then
    if now() < r.phase_ends_at then
      return false;
    end if;
    perform public._return_to_lobby(r.id);
    return true;
  end if;

  return false;
end;
$$;

create function public._room_state(p_room_id uuid) returns jsonb
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

create function public._generate_room_code() returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::integer, 1), '')
  from generate_series(1, 6);
$$;

create function public.create_room(
  p_mode text,
  p_max_players integer default 8,
  p_produce_seconds integer default 1200,
  p_vote_seconds integer default 20,
  p_is_private boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  v_room public.rooms;
  v_previous uuid;
begin
  if p_mode not in ('classic', 'premade', 'creative') then
    raise exception using errcode = 'P0001', message = 'invalid_mode';
  end if;
  if p_max_players not between 2 and 16
     or p_produce_seconds not between 60 and 7200
     or p_vote_seconds not between 5 and 120 then
    raise exception using errcode = 'P0001', message = 'invalid_settings';
  end if;
  if not exists (select 1 from public.profiles where id = v_uid) then
    raise exception using errcode = 'P0001', message = 'profile_missing';
  end if;

  perform public._lock_user(v_uid);
  select room_id into v_previous from public.room_players where user_id = v_uid and left_at is null;
  if v_previous is not null then
    perform public._lock_room(v_previous);
    perform public._leave_room_locked(v_previous, v_uid);
    perform public._bump(v_previous);
  end if;

  for i in 1..20 loop
    insert into public.rooms (code, host_id, mode, max_players, produce_seconds, vote_seconds, is_private)
    values (public._generate_room_code(), v_uid, p_mode, p_max_players, p_produce_seconds, p_vote_seconds, p_is_private)
    on conflict (code) do nothing
    returning * into v_room;
    exit when v_room.id is not null;
  end loop;
  if v_room.id is null then
    raise exception using errcode = 'P0001', message = 'code_generation_failed';
  end if;

  insert into public.room_players (room_id, user_id) values (v_room.id, v_uid);
  return jsonb_build_object('room_id', v_room.id, 'code', v_room.code, 'version', v_room.version);
end;
$$;

create function public.join_room(p_code text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  v_room_id uuid;
  v_previous uuid;
  v_lock_id uuid;
  r public.rooms;
begin
  perform public._lock_user(v_uid);
  select id into v_room_id from public.rooms where code = upper(btrim(p_code));
  if v_room_id is null then
    raise exception using errcode = 'P0001', message = 'room_not_found';
  end if;

  select room_id into v_previous from public.room_players where user_id = v_uid and left_at is null;
  if v_previous = v_room_id then
    select * into r from public.rooms where id = v_room_id;
    return jsonb_build_object('room_id', r.id, 'code', r.code, 'version', r.version);
  end if;

  for v_lock_id in
    select id from unnest(array[v_room_id, v_previous]) as t(id) where id is not null order by id
  loop
    perform public._lock_room(v_lock_id);
  end loop;
  select * into r from public.rooms where id = v_room_id;

  if r.status = 'closed' then
    raise exception using errcode = 'P0001', message = 'room_closed';
  end if;
  if public._active_player_count(r.id) >= r.max_players then
    raise exception using errcode = 'P0001', message = 'room_full';
  end if;

  if v_previous is not null then
    perform public._leave_room_locked(v_previous, v_uid);
    perform public._bump(v_previous);
  end if;

  insert into public.room_players (room_id, user_id)
  values (r.id, v_uid)
  on conflict (room_id, user_id) do update
  set left_at = null, joined_at = now(), is_ready = false;

  return jsonb_build_object('room_id', r.id, 'code', r.code, 'version', public._bump(r.id));
end;
$$;

-- Marks the player as left, hands off host and closes an empty room. Caller
-- holds the user and room locks and bumps the room's version.
create function public._leave_room_locked(p_room_id uuid, p_uid uuid) returns void
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

  if r.host_id is not distinct from p_uid then
    select user_id into v_next_host from public.room_players
    where room_id = r.id and left_at is null
    order by joined_at, user_id
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

create function public.leave_room(p_room_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
begin
  perform public._lock_user(v_uid);
  perform public._lock_room(p_room_id);
  perform public._require_active_member(p_room_id, v_uid);
  perform public._leave_room_locked(p_room_id, v_uid);
  perform public._bump(p_room_id);
end;
$$;

create function public.set_ready(p_room_id uuid, p_ready boolean) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  r public.rooms := public._lock_room(p_room_id);
begin
  perform public._require_active_member(r.id, v_uid);
  if r.status <> 'lobby' then
    raise exception using errcode = 'P0001', message = 'wrong_phase';
  end if;
  update public.room_players set is_ready = p_ready where room_id = r.id and user_id = v_uid;
  perform public._bump(r.id);
end;
$$;

create function public.start_game(p_room_id uuid, p_force boolean default false) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  r public.rooms := public._lock_room(p_room_id);
  v_round integer;
begin
  perform public._require_active_member(r.id, v_uid);
  if r.host_id is distinct from v_uid then
    raise exception using errcode = 'P0001', message = 'not_host';
  end if;
  if r.status <> 'lobby' then
    raise exception using errcode = 'P0001', message = 'wrong_phase';
  end if;
  if public._active_player_count(r.id) < 2 then
    raise exception using errcode = 'P0001', message = 'not_enough_players';
  end if;
  if not coalesce(p_force, false) and exists (
    select 1 from public.room_players
    where room_id = r.id and left_at is null and not is_ready and user_id <> r.host_id
  ) then
    raise exception using errcode = 'P0001', message = 'not_all_ready';
  end if;

  v_round := r.round + 1;

  if r.mode = 'creative' then
    insert into public.room_assets (room_id, round, kind, prompt_id, position)
    select r.id, v_round, 'prompt', id, 0 from public.prompts where active order by random() limit 1;
    if not found then
      raise exception using errcode = 'P0001', message = 'no_prompts';
    end if;
  elsif r.mode = 'classic' then
    -- Shared pack for the whole room, drawn per sample_recipe. Samples used
    -- last round go to the back of the draw so rematches get fresh picks; a
    -- short pool just yields fewer samples.
    insert into public.room_assets (room_id, round, kind, sample_id, position)
    select r.id, v_round, 'sample', pick.id,
           (row_number() over (order by pick.recipe_position, pick.draw))::integer - 1
    from (
      select s.id, rc.position as recipe_position, rc.count,
             row_number() over (
               partition by s.category
               order by exists (
                 select 1 from public.room_assets prev
                 where prev.room_id = r.id and prev.round = r.round and prev.sample_id = s.id
               ), random()
             ) as draw
      from public.samples s
      join public.sample_recipe rc on rc.category = s.category
      where s.active
    ) pick
    where pick.draw <= pick.count;
  end if;

  update public.room_players set is_ready = false where room_id = r.id;
  update public.rooms
  set status = 'producing',
      round = v_round,
      track_order = '{}',
      current_track = null,
      track_started_at = null,
      phase_started_at = now(),
      -- 15s upload grace after the produce timer; clients show the produce
      -- deadline as phase_ends_at minus the grace.
      phase_ends_at = now() + make_interval(secs => r.produce_seconds + 15)
  where id = r.id;

  perform public._bump(r.id);
end;
$$;

create function public.submit_track(p_room_id uuid, p_storage_path text, p_duration_ms integer) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  r public.rooms := public._lock_room(p_room_id);
  v_submission_id uuid;
begin
  perform public._require_active_member(r.id, v_uid);
  if r.status <> 'producing' then
    raise exception using errcode = 'P0001', message = 'wrong_phase';
  end if;
  if now() >= r.phase_ends_at then
    raise exception using errcode = 'P0001', message = 'deadline_passed';
  end if;
  if p_duration_ms is null or p_duration_ms not between 1000 and 600000 then
    raise exception using errcode = 'P0001', message = 'invalid_duration';
  end if;
  if p_storage_path is null
     or left(p_storage_path, length(r.id::text || '/' || r.round || '/' || v_uid::text || '/'))
        <> r.id::text || '/' || r.round || '/' || v_uid::text || '/'
     or p_storage_path like '%..%' then
    raise exception using errcode = 'P0001', message = 'invalid_path';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'submissions' and name = p_storage_path) then
    raise exception using errcode = 'P0001', message = 'upload_missing';
  end if;

  insert into public.submissions (room_id, round, user_id, storage_path, duration_ms)
  values (r.id, r.round, v_uid, p_storage_path, p_duration_ms)
  on conflict (room_id, round, user_id) do update
  set storage_path = excluded.storage_path, duration_ms = excluded.duration_ms, submitted_at = now()
  returning id into v_submission_id;

  perform public._advance_step(r.id);
  perform public._bump(r.id);
  return v_submission_id;
end;
$$;

create function public.cast_vote(p_room_id uuid, p_submission_id uuid, p_score integer) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  r public.rooms := public._lock_room(p_room_id);
  v_sub public.submissions;
begin
  perform public._require_active_member(r.id, v_uid);
  if r.status <> 'listening' then
    raise exception using errcode = 'P0001', message = 'wrong_phase';
  end if;
  if now() >= r.phase_ends_at then
    raise exception using errcode = 'P0001', message = 'deadline_passed';
  end if;
  v_sub := public._current_submission(r);
  if v_sub.id is null or v_sub.id <> p_submission_id then
    raise exception using errcode = 'P0001', message = 'not_current_track';
  end if;
  if p_score is null or p_score not between 1 and 5 then
    raise exception using errcode = 'P0001', message = 'invalid_score';
  end if;
  if v_sub.user_id = v_uid then
    raise exception using errcode = 'P0001', message = 'self_vote';
  end if;

  begin
    insert into public.votes (room_id, round, submission_id, voter_id, score)
    values (r.id, r.round, v_sub.id, v_uid, p_score);
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'already_voted';
  end;

  perform public._advance_step(r.id);
  perform public._bump(r.id);
end;
$$;

create function public.send_chat(p_room_id uuid, p_body text) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_id bigint;
begin
  perform public._require_active_member(p_room_id, v_uid);
  if char_length(v_body) not between 1 and 500 then
    raise exception using errcode = 'P0001', message = 'invalid_message';
  end if;
  if (
    select count(*) from public.chat_messages
    where room_id = p_room_id and user_id = v_uid and created_at > now() - interval '5 seconds'
  ) >= 5 then
    raise exception using errcode = 'P0001', message = 'rate_limited';
  end if;

  insert into public.chat_messages (room_id, user_id, body)
  values (p_room_id, v_uid, v_body)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.advance_room(p_room_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  r public.rooms := public._lock_room(p_room_id);
  v_advanced boolean;
  v_version bigint := r.version;
begin
  perform public._require_active_member(r.id, v_uid);
  v_advanced := public._advance_step(r.id);
  if v_advanced then
    v_version := public._bump(r.id);
  end if;
  return jsonb_build_object('advanced', v_advanced, 'version', v_version);
end;
$$;

create function public.get_room_snapshot(p_room_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  v_round integer;
begin
  if not exists (select 1 from public.room_players where room_id = p_room_id and user_id = v_uid) then
    raise exception using errcode = 'P0001', message = 'not_member';
  end if;
  select round into v_round from public.rooms where id = p_room_id;

  return public._room_state(p_room_id) || jsonb_build_object(
    'server_time', clock_timestamp(),
    'me', v_uid,
    'my_votes', coalesce((
      select jsonb_agg(jsonb_build_object('submission_id', v.submission_id, 'score', v.score) order by v.id)
      from public.votes v
      where v.room_id = p_room_id and v.round = v_round and v.voter_id = v_uid
    ), '[]'::jsonb),
    'chat', coalesce((
      select jsonb_agg(m.msg order by m.id)
      from (
        select c.id, jsonb_build_object(
          'id', c.id, 'room_id', c.room_id, 'user_id', c.user_id, 'username', p.username,
          'body', c.body, 'created_at', c.created_at
        ) as msg
        from public.chat_messages c
        join public.profiles p on p.id = c.user_id
        where c.room_id = p_room_id
        order by c.id desc
        limit 50
      ) m
    ), '[]'::jsonb)
  );
end;
$$;

create function public.list_public_rooms() returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x.room order by x.created_at desc), '[]'::jsonb)
  from (
    select r.created_at, jsonb_build_object(
      'id', r.id,
      'code', r.code,
      'mode', r.mode,
      'status', r.status,
      'max_players', r.max_players,
      'player_count', public._active_player_count(r.id),
      'host_username', p.username
    ) as room
    from public.rooms r
    left join public.profiles p on p.id = r.host_id
    where not r.is_private and r.status <> 'closed'
    order by r.created_at desc
    limit 100
  ) x;
$$;

create function public.server_time() returns timestamptz
language sql
volatile
set search_path = ''
as $$
  select clock_timestamp();
$$;

-- Backstop for rooms whose clients all went away mid-phase. Scheduled by
-- pg_cron; skip locked so it never waits behind a live RPC.
create function public.sweep_rooms() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_count integer := 0;
begin
  for v_room_id in
    select id from public.rooms
    where status in ('producing', 'listening', 'results') and phase_ends_at <= now()
    for update skip locked
  loop
    if public._advance_step(v_room_id) then
      perform public._bump(v_room_id);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

revoke execute on function
  public._lock_room(uuid),
  public._lock_user(uuid),
  public._leave_room_locked(uuid, uuid),
  public._require_uid(),
  public._require_active_member(uuid, uuid),
  public._active_player_count(uuid),
  public._bump(uuid),
  public._current_submission(public.rooms),
  public._all_submitted(public.rooms),
  public._all_voted(public.rooms),
  public._start_track(uuid, integer),
  public._enter_results(uuid),
  public._return_to_lobby(uuid),
  public._advance_step(uuid),
  public._room_state(uuid),
  public._generate_room_code(),
  public.sweep_rooms()
from public, anon, authenticated;

revoke execute on function
  public.create_room(text, integer, integer, integer, boolean),
  public.join_room(text),
  public.leave_room(uuid),
  public.set_ready(uuid, boolean),
  public.start_game(uuid, boolean),
  public.submit_track(uuid, text, integer),
  public.cast_vote(uuid, uuid, integer),
  public.send_chat(uuid, text),
  public.advance_room(uuid),
  public.get_room_snapshot(uuid),
  public.list_public_rooms()
from public, anon;

grant execute on function
  public.create_room(text, integer, integer, integer, boolean),
  public.join_room(text),
  public.leave_room(uuid),
  public.set_ready(uuid, boolean),
  public.start_game(uuid, boolean),
  public.submit_track(uuid, text, integer),
  public.cast_vote(uuid, uuid, integer),
  public.send_chat(uuid, text),
  public.advance_room(uuid),
  public.get_room_snapshot(uuid),
  public.list_public_rooms()
to authenticated;

grant execute on function public.server_time() to anon, authenticated;
