alter table public.rooms add column autostart_at timestamptz;

create index rooms_autostart_idx on public.rooms (autostart_at) where status = 'lobby' and autostart_at is not null;

create function public._lobby_all_ready(p_room_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) >= 2 and coalesce(bool_and(rp.is_ready or p.is_bot), false)
  from public.room_players rp
  join public.profiles p on p.id = rp.user_id
  where rp.room_id = p_room_id and rp.left_at is null and rp.last_seen_at > public._fresh_cutoff();
$$;

create function public._sync_autostart(p_room_id uuid, p_restart boolean) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.rooms;
  v_at timestamptz;
begin
  select * into r from public.rooms where id = p_room_id;
  if r.status = 'lobby' and public._lobby_all_ready(r.id) then
    v_at := case when p_restart or r.autostart_at is null then now() + interval '5 seconds' else r.autostart_at end;
  end if;
  if v_at is distinct from r.autostart_at then
    update public.rooms set autostart_at = v_at where id = r.id;
  end if;
end;
$$;

create function public._start_game_locked(p_room public.rooms) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round integer;
begin
  v_round := p_room.round + 1;

  if p_room.mode = 'creative' then
    insert into public.room_assets (room_id, round, kind, prompt_id, position)
    select p_room.id, v_round, 'prompt', id, 0 from public.prompts where active order by random() limit 1;
    if not found then
      raise exception using errcode = 'P0001', message = 'no_prompts';
    end if;
  elsif p_room.mode = 'classic' then
    insert into public.room_assets (room_id, round, kind, sample_id, position)
    select p_room.id, v_round, 'sample', pick.id,
           (row_number() over (order by pick.recipe_position, pick.draw))::integer - 1
    from (
      select s.id, rc.position as recipe_position, rc.count,
             row_number() over (
               partition by s.category
               order by exists (
                 select 1 from public.room_assets prev
                 where prev.room_id = p_room.id and prev.round = p_room.round and prev.sample_id = s.id
               ), random()
             ) as draw
      from public.samples s
      join public.sample_recipe rc on rc.category = s.category
      where s.active
    ) pick
    where pick.draw <= pick.count;
  end if;

  update public.room_players set is_ready = false where room_id = p_room.id;
  update public.rooms
  set status = 'producing',
      round = v_round,
      track_order = '{}',
      current_track = null,
      track_started_at = null,
      autostart_at = null,
      phase_started_at = now(),
      phase_ends_at = now() + make_interval(secs => public._produce_seconds(p_room.mode, p_room.produce_seconds) + 15)
  where id = p_room.id;
end;
$$;

create or replace function public.start_game(p_room_id uuid, p_force boolean default false) returns void
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
  if (
    select count(*) from public.room_players
    where room_id = r.id and left_at is null and last_seen_at > public._fresh_cutoff()
  ) < 2 then
    raise exception using errcode = 'P0001', message = 'not_enough_players';
  end if;
  if not coalesce(p_force, false) and not public._lobby_all_ready(r.id) then
    raise exception using errcode = 'P0001', message = 'not_all_ready';
  end if;

  perform public._start_game_locked(r);
  perform public._bump(r.id);
end;
$$;

create or replace function public.set_ready(p_room_id uuid, p_ready boolean) returns void
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
  perform public._sync_autostart(r.id, false);
  perform public._bump(r.id);
end;
$$;

create or replace function public.update_room_settings(
  p_room_id uuid,
  p_name text default null,
  p_max_players integer default null,
  p_produce_seconds integer default null,
  p_vote_seconds integer default null,
  p_is_private boolean default null,
  p_mode text default null,
  p_reveal_names boolean default null,
  p_listen_seconds integer default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  r public.rooms := public._lock_room(p_room_id);
  v_mode text := coalesce(p_mode, r.mode);
  v_produce integer;
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
     or (v_mode <> 'premade' and p_produce_seconds not between 60 and 7200)
     or p_listen_seconds not between 30 and 60 then
    raise exception using errcode = 'P0001', message = 'invalid_settings';
  end if;
  if p_max_players < public._active_player_count(r.id) then
    raise exception using errcode = 'P0001', message = 'max_players_below_count';
  end if;

  v_produce := case
    when v_mode = 'premade' then null
    when p_produce_seconds is not null then p_produce_seconds
    when r.mode = 'premade' then 1200
    else r.produce_seconds
  end;

  update public.rooms
  set name = case when p_name is null then name else public._room_name(p_name, v_uid) end,
      max_players = coalesce(p_max_players, max_players),
      produce_seconds = public._produce_seconds(v_mode, v_produce),
      is_private = coalesce(p_is_private, is_private),
      mode = coalesce(p_mode, mode),
      reveal_names = coalesce(p_reveal_names, reveal_names),
      listen_seconds = coalesce(p_listen_seconds, listen_seconds)
  where id = r.id;

  if p_mode is distinct from r.mode and p_mode is not null
     or v_mode <> 'premade' and p_produce_seconds is distinct from r.produce_seconds and p_produce_seconds is not null
     or p_listen_seconds is distinct from r.listen_seconds and p_listen_seconds is not null then
    update public.room_players set is_ready = false
    where room_id = r.id and user_id <> v_uid and is_ready;
  end if;
  perform public._sync_autostart(r.id, true);

  perform public._bump(r.id);
end;
$$;

create or replace function public._join_room_locked(p_uid uuid, p_room_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous uuid;
  v_lock_id uuid;
  r public.rooms;
begin
  if exists (select 1 from public.room_bans where room_id = p_room_id and user_id = p_uid) then
    raise exception using errcode = 'P0001', message = 'banned_from_room';
  end if;
  select room_id into v_previous from public.room_players where user_id = p_uid and left_at is null;
  if v_previous = p_room_id then
    update public.room_players set last_seen_at = now() where room_id = p_room_id and user_id = p_uid;
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
  set left_at = null, joined_at = now(), last_seen_at = now(), is_ready = false;
  delete from public.kick_votes where room_id = r.id and target_id = p_uid;
  perform public._sync_autostart(r.id, true);

  return jsonb_build_object('room_id', r.id, 'code', r.code, 'version', public._bump(r.id));
end;
$$;

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

  perform public._sync_autostart(r.id, true);

  if public._active_player_count(r.id) = 0 then
    update public.rooms
    set status = 'closed', phase_ends_at = null, current_track = null, track_started_at = null, autostart_at = null
    where id = r.id;
  else
    perform public._advance_step(r.id);
  end if;
end;
$$;

create or replace function public._advance_step(p_room_id uuid) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.rooms;
  v_order uuid[];
  v_current uuid;
  v_closed_at timestamptz;
begin
  select * into r from public.rooms where id = p_room_id;

  if r.status = 'lobby' then
    if r.autostart_at is null or now() < r.autostart_at then
      return false;
    end if;
    if public._lobby_all_ready(r.id) then
      perform public._start_game_locked(r);
    else
      update public.rooms set autostart_at = null where id = r.id;
    end if;
    return true;
  end if;

  if r.status = 'producing' then
    if now() < r.phase_ends_at and not public._all_submitted(r) then
      return false;
    end if;
    update public.submissions
    set confirmed = true,
        clip_start_ms = coalesce(clip_start_ms, 0),
        clip_end_ms = coalesce(clip_end_ms, least(duration_ms, r.listen_seconds * 1000))
    where room_id = r.id and round = r.round and (not confirmed or clip_start_ms is null);
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
    if now() < r.phase_ends_at and not public._skip_reached(r) then
      return false;
    end if;
    v_current := (public._current_submission(r)).id;
    if r.closed_track_id is distinct from v_current then
      perform public._apply_default_votes(r);
      v_closed_at := least(now(), r.phase_ends_at);
      update public.rooms set closed_track_id = v_current, closed_track_at = v_closed_at where id = r.id;
      if r.current_track + 1 >= cardinality(r.track_order) and now() < v_closed_at + public._vote_tolerance() then
        update public.rooms set phase_ends_at = v_closed_at + public._vote_tolerance() where id = r.id;
        return true;
      end if;
    elsif now() < r.phase_ends_at then
      return false;
    end if;
    if r.current_track + 1 < cardinality(r.track_order) then
      perform public._start_track(r.id, r.current_track + 1);
    else
      perform public._enter_review(r.id);
    end if;
    return true;
  end if;

  if r.status = 'reviewing' then
    if now() < r.phase_ends_at and not public._review_all_done(r) then
      return false;
    end if;
    perform public._enter_results(r.id);
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

create or replace function public.sweep_rooms() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_user_id uuid;
  v_count integer := 0;
begin
  for v_room_id in
    select id from public.rooms
    where status in ('producing', 'listening', 'reviewing', 'results') and phase_ends_at <= now()
    union all
    select id from public.rooms where status = 'lobby' and autostart_at <= now()
  loop
    begin
      perform 1 from public.rooms where id = v_room_id for update skip locked;
      if found and public._advance_step(v_room_id) then
        perform public._bump(v_room_id);
        v_count := v_count + 1;
      end if;
    exception when others then
      raise warning 'sweep_rooms: advancing room % failed: %', v_room_id, sqlerrm;
    end;
  end loop;

  for v_room_id, v_user_id in
    select rp.room_id, rp.user_id
    from public.room_players rp
    join public.rooms r on r.id = rp.room_id
    where r.status = 'lobby' and rp.left_at is null and rp.last_seen_at <= public._fresh_cutoff()
    order by rp.room_id, rp.joined_at
  loop
    begin
      if pg_try_advisory_xact_lock(hashtextextended('room_membership:' || v_user_id::text, 0)) then
        perform 1 from public.rooms where id = v_room_id and status = 'lobby' for update skip locked;
        if found and exists (
          select 1 from public.room_players
          where room_id = v_room_id and user_id = v_user_id
            and left_at is null and last_seen_at <= public._fresh_cutoff()
        ) then
          perform public._leave_room_locked(v_room_id, v_user_id);
          perform public._bump(v_room_id);
          v_count := v_count + 1;
        end if;
      end if;
    exception when others then
      raise warning 'sweep_rooms: removing idle member % from room % failed: %', v_user_id, v_room_id, sqlerrm;
    end;
  end loop;

  return v_count;
end;
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
      'reveal_names', r.reveal_names,
      'listen_seconds', r.listen_seconds,
      'status', r.status,
      'round', r.round,
      'phase_started_at', r.phase_started_at,
      'phase_ends_at', r.phase_ends_at,
      'track_order', to_jsonb(r.track_order),
      'current_track', r.current_track,
      'track_started_at', r.track_started_at,
      'autostart_at', r.autostart_at
    ),
    'readiness', (
      select jsonb_build_object(
        'ready', count(*) filter (where rp.is_ready or p.is_bot),
        'total', count(*),
        'all_ready', count(*) filter (where rp.is_ready or p.is_bot) = count(*),
        'can_start', count(*) >= 2 and count(*) filter (where rp.is_ready or p.is_bot) = count(*)
      )
      from public.room_players rp
      join public.profiles p on p.id = rp.user_id
      where rp.room_id = r.id and rp.left_at is null and rp.last_seen_at > public._fresh_cutoff()
    ),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', rp.user_id,
        'username', p.username,
        'display_name', p.display_name,
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
      when r.status in ('listening', 'reviewing') then coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', s.id,
          'user_id', case when r.reveal_names and (r.status = 'reviewing' or t.ord <= r.current_track + 1) then s.user_id end,
          'storage_path', s.storage_path,
          'duration_ms', s.duration_ms,
          'clip_start_ms', public._clip_start_ms(s),
          'clip_end_ms', public._clip_end_ms(s, r.listen_seconds),
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
          'clip_start_ms', public._clip_start_ms(s),
          'clip_end_ms', public._clip_end_ms(s, r.listen_seconds),
          'submitted_at', s.submitted_at
        ) order by s.submitted_at)
        from public.submissions s
        where s.room_id = r.id and s.round = r.round
      ), '[]'::jsonb)
    end,
    'submitted_user_ids', coalesce((
      select jsonb_agg(s.user_id order by s.user_id)
      from public.submissions s
      where s.room_id = r.id and s.round = r.round and s.confirmed
    ), '[]'::jsonb),
    'votes_cast', case
      when r.status in ('listening', 'reviewing') and not r.reveal_names then '[]'::jsonb
      else coalesce((
        select jsonb_agg(jsonb_build_object('submission_id', v.submission_id, 'voter_id', v.voter_id) order by v.id)
        from public.votes v
        where v.room_id = r.id and v.round = r.round
      ), '[]'::jsonb)
    end,
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
    'review', case when r.status = 'reviewing' then jsonb_build_object(
      'done_user_ids', coalesce((
        select jsonb_agg(d.user_id order by d.created_at, d.user_id)
        from public.review_done d
        where d.room_id = r.id and d.round = r.round
      ), '[]'::jsonb),
      'total', (select count(*) from public._review_participants(r))
    ) end,
    'kick_votes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'target_user_id', t.target_id,
        'votes', c.votes,
        'needed', c.needed,
        'expires_at', c.expires_at
      ) order by c.expires_at, t.target_id)
      from (
        select distinct k.target_id
        from public.kick_votes k
        join public.room_players rp on rp.room_id = k.room_id and rp.user_id = k.target_id and rp.left_at is null
        where k.room_id = r.id
      ) t
      cross join lateral public._kick_counts(r.id, t.target_id) c
      where c.votes > 0
    ), '[]'::jsonb),
    'results', coalesce((
      select jsonb_agg(jsonb_build_object(
        'submission_id', rr.submission_id,
        'user_id', rr.user_id,
        'avg_score', rr.avg_score,
        'vote_count', rr.vote_count,
        'rank', rr.rank,
        'is_winner', rr.is_winner,
        'clip_start_ms', public._clip_start_ms(cs),
        'clip_end_ms', public._clip_end_ms(cs, r.listen_seconds)
      ) order by rr.rank, rr.user_id)
      from public.round_results rr
      join public.submissions cs on cs.id = rr.submission_id
      where rr.room_id = r.id and rr.round = r.round
    ), '[]'::jsonb)
  )
  from public.rooms r
  where r.id = p_room_id;
$$;

revoke execute on function
  public._lobby_all_ready(uuid),
  public._sync_autostart(uuid, boolean),
  public._start_game_locked(public.rooms)
from public, anon, authenticated;
