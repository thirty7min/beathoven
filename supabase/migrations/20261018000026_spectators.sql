alter table public.room_players
  add column role text not null default 'player' check (role in ('player', 'spectator'));

create function public._max_spectators() returns integer
language sql
immutable
set search_path = ''
as $$
  select 50;
$$;

create or replace function public._require_active_member(p_room_id uuid, p_uid uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  update public.room_players set last_seen_at = now()
  where room_id = p_room_id and user_id = p_uid and left_at is null
  returning role into v_role;
  if v_role is null then
    raise exception using errcode = 'P0001', message = 'not_member';
  end if;
  if v_role = 'spectator' then
    raise exception using errcode = 'P0001', message = 'spectating';
  end if;
end;
$$;

create function public._require_in_room(p_room_id uuid, p_uid uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.room_players set last_seen_at = now()
  where room_id = p_room_id and user_id = p_uid and left_at is null;
  if not found then
    raise exception using errcode = 'P0001', message = 'not_member';
  end if;
end;
$$;

create or replace function public._active_player_count(p_room_id uuid) returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.room_players where room_id = p_room_id and left_at is null and role = 'player';
$$;

create function public._promote_spectators(p_room_id uuid) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seats integer;
  v_count integer;
begin
  select r.max_players - public._active_player_count(r.id) into v_seats
  from public.rooms r
  where r.id = p_room_id and r.status = 'lobby';
  if coalesce(v_seats, 0) <= 0 then
    return 0;
  end if;
  update public.room_players
  set role = 'player', is_ready = false
  where room_id = p_room_id and user_id in (
    select s.user_id from public.room_players s
    where s.room_id = p_room_id and s.left_at is null and s.role = 'spectator'
    order by s.joined_at, s.user_id
    limit v_seats
  );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public._lobby_all_ready(p_room_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) >= 2 and coalesce(bool_and(rp.is_ready or p.is_bot), false)
  from public.room_players rp
  join public.profiles p on p.id = rp.user_id
  where rp.room_id = p_room_id and rp.left_at is null and rp.role = 'player' and rp.last_seen_at > public._fresh_cutoff();
$$;

create or replace function public._all_submitted(p_room public.rooms) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.room_players
      where room_id = p_room.id and left_at is null and role = 'player' and last_seen_at > public._fresh_cutoff()
    )
    and not exists (
      select 1 from public.room_players rp
      where rp.room_id = p_room.id and rp.left_at is null and rp.role = 'player' and rp.last_seen_at > public._fresh_cutoff()
        and not exists (
          select 1 from public.submissions s
          where s.room_id = p_room.id and s.round = p_room.round and s.user_id = rp.user_id and s.confirmed
        )
    );
$$;

create or replace function public._eligible_voters(p_room public.rooms) returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select rp.user_id
  from public.room_players rp
  where rp.room_id = p_room.id
    and rp.left_at is null
    and rp.role = 'player'
    and rp.last_seen_at > public._fresh_cutoff()
    and rp.user_id is distinct from (select s.user_id from public._current_submission(p_room) s);
$$;

create or replace function public._skip_voters(p_room public.rooms) returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select rp.user_id
  from public.room_players rp
  join public.profiles p on p.id = rp.user_id
  where rp.room_id = p_room.id
    and rp.left_at is null
    and rp.role = 'player'
    and rp.last_seen_at > public._fresh_cutoff()
    and not p.is_bot;
$$;

create or replace function public._review_participants(p_room public.rooms) returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select rp.user_id
  from public.room_players rp
  join public.profiles p on p.id = rp.user_id
  where rp.room_id = p_room.id
    and rp.left_at is null
    and rp.role = 'player'
    and rp.last_seen_at > public._fresh_cutoff()
    and not p.is_bot;
$$;

create or replace function public._kick_counts(
  p_room_id uuid,
  p_target uuid,
  out votes integer,
  out needed integer,
  out eligible integer,
  out expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with win as (
    select min(created_at) + interval '2 minutes' as ends_at
    from public.kick_votes where room_id = p_room_id and target_id = p_target
  ),
  voters as (
    select rp.user_id
    from public.room_players rp
    join public.profiles p on p.id = rp.user_id
    where rp.room_id = p_room_id and rp.left_at is null and rp.role = 'player' and rp.last_seen_at > public._fresh_cutoff()
      and not p.is_bot and rp.user_id <> p_target
  )
  select
    (select count(*)::integer from public.kick_votes k, win
     where k.room_id = p_room_id and k.target_id = p_target and win.ends_at > now()
       and k.voter_id in (select user_id from voters)),
    (select count(*)::integer / 2 + 1 from voters),
    (select count(*)::integer from voters),
    (select ends_at from win where ends_at > now());
$$;

create or replace function public._estimated_end_at(p_room public.rooms) returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case p_room.status
    when 'results' then p_room.phase_ends_at
    when 'reviewing' then p_room.phase_ends_at + interval '30 seconds'
    when 'listening' then p_room.phase_ends_at + interval '60 seconds' + coalesce((
      select sum(make_interval(
        secs => 3 + public._clip_play_ms(s, p_room.listen_seconds) / 1000.0
      ))
      from unnest(p_room.track_order) with ordinality as t(id, ord)
      join public.submissions s on s.id = t.id
      where t.ord > p_room.current_track + 1
    ), interval '0')
    when 'producing' then p_room.phase_ends_at + interval '60 seconds' + (
      select make_interval(secs =>
        greatest(public._active_player_count(p_room.id), count(*)) * (
          3
          + coalesce(avg(public._clip_play_ms(s, p_room.listen_seconds)), p_room.listen_seconds * 1000) / 1000.0
        )
      )
      from public.submissions s
      where s.room_id = p_room.id and s.round = p_room.round
    )
  end;
$$;

create or replace function public._return_to_lobby(p_room_id uuid) returns void
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
  perform public._promote_spectators(p_room_id);
end;
$$;

create or replace function public._leave_room_locked(p_room_id uuid, p_uid uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.rooms;
  v_role text;
  v_next_host uuid;
begin
  select * into r from public.rooms where id = p_room_id;

  update public.room_players set left_at = now(), is_ready = false
  where room_id = r.id and user_id = p_uid
  returning role into v_role;

  perform public._promote_spectators(r.id);

  if not exists (
    select 1 from public.room_players rp
    join public.profiles p on p.id = rp.user_id
    where rp.room_id = r.id and rp.left_at is null and rp.role = 'player' and not p.is_bot
  ) then
    update public.room_players set left_at = now(), is_ready = false
    where room_id = r.id and left_at is null;
  end if;

  if r.host_id is not distinct from p_uid then
    select rp.user_id into v_next_host
    from public.room_players rp
    join public.profiles p on p.id = rp.user_id
    where rp.room_id = r.id and rp.left_at is null and rp.role = 'player'
    order by p.is_bot, rp.joined_at, rp.user_id
    limit 1;
    if v_next_host is not null then
      update public.rooms set host_id = v_next_host where id = r.id;
    end if;
  end if;

  perform public._sync_autostart(r.id, v_role is distinct from 'spectator');

  if public._active_player_count(r.id) = 0 then
    update public.rooms
    set status = 'closed', phase_ends_at = null, current_track = null, track_started_at = null, autostart_at = null
    where id = r.id;
  else
    perform public._advance_step(r.id);
  end if;
end;
$$;

drop function public._join_room_locked(uuid, uuid);

create function public._join_room_locked(p_uid uuid, p_room_id uuid, p_spectate boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous uuid;
  v_lock_id uuid;
  v_role text;
  r public.rooms;
begin
  if exists (select 1 from public.room_bans where room_id = p_room_id and user_id = p_uid) then
    raise exception using errcode = 'P0001', message = 'banned_from_room';
  end if;
  select room_id into v_previous from public.room_players where user_id = p_uid and left_at is null;
  if v_previous = p_room_id then
    update public.room_players set last_seen_at = now() where room_id = p_room_id and user_id = p_uid
    returning role into v_role;
    select * into r from public.rooms where id = p_room_id;
    return jsonb_build_object('room_id', r.id, 'code', r.code, 'version', r.version, 'role', v_role);
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
  if r.status = 'lobby' and public._active_player_count(r.id) < r.max_players then
    v_role := 'player';
  elsif not p_spectate then
    raise exception using errcode = 'P0001', message = case when r.status = 'lobby' then 'room_full' else 'room_in_progress' end;
  elsif (
    select count(*) from public.room_players where room_id = r.id and left_at is null and role = 'spectator'
  ) >= public._max_spectators() then
    raise exception using errcode = 'P0001', message = 'spectators_full';
  else
    v_role := 'spectator';
  end if;

  if v_previous is not null then
    perform public._leave_room_locked(v_previous, p_uid);
    perform public._bump(v_previous);
  end if;

  insert into public.room_players (room_id, user_id, role)
  values (r.id, p_uid, v_role)
  on conflict (room_id, user_id) do update
  set left_at = null, joined_at = now(), last_seen_at = now(), is_ready = false, role = excluded.role;
  delete from public.kick_votes where room_id = r.id and target_id = p_uid;
  if v_role = 'player' then
    perform public._sync_autostart(r.id, true);
  end if;

  return jsonb_build_object('room_id', r.id, 'code', r.code, 'version', public._bump(r.id), 'role', v_role);
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
  return public._join_room_locked(v_uid, v_room_id, true);
end;
$$;

create or replace function public.quick_match(p_mode text, p_genre text default 'all') returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  v_candidate uuid;
  v_result jsonb;
begin
  if p_mode not in ('classic', 'premade', 'creative') then
    raise exception using errcode = 'P0001', message = 'invalid_mode';
  end if;
  if p_genre is null or not public._valid_genre(p_genre) then
    raise exception using errcode = 'P0001', message = 'invalid_genre';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('quick_match:' || p_mode, 0));
  perform public._lock_user(v_uid);

  for v_candidate in
    select r.id
    from public.rooms r
    cross join lateral (
      select count(*) filter (where rp.role = 'player') as active,
             count(*) filter (where rp.role = 'player' and rp.last_seen_at > public._fresh_cutoff()) as fresh,
             bool_or(rp.user_id = v_uid and rp.role = 'player') as mine
      from public.room_players rp
      where rp.room_id = r.id and rp.left_at is null
    ) pc
    where r.mode = p_mode and r.status = 'lobby' and not r.is_private
      and (p_genre = 'all' or r.genre in (p_genre, 'all'))
      and not exists (select 1 from public.room_bans b where b.room_id = r.id and b.user_id = v_uid)
      and (pc.mine or (pc.fresh > 0 and pc.active < r.max_players))
    order by r.genre = p_genre desc, pc.fresh desc, r.created_at, r.id
    limit 20
  loop
    begin
      return public._join_room_locked(v_uid, v_candidate, false) || jsonb_build_object('created', false);
    exception when sqlstate 'P0001' then
      if sqlerrm not in ('room_full', 'room_closed', 'room_in_progress', 'banned_from_room') then
        raise;
      end if;
    end;
  end loop;

  v_result := public._create_room_locked(v_uid, p_mode, 8, 1200, 20, false, null);
  update public.rooms set genre = p_genre where id = (v_result ->> 'room_id')::uuid;
  return v_result || jsonb_build_object('created', true);
end;
$$;

create or replace function public.dev_add_bot(p_room_id uuid) returns jsonb
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
  perform public._join_room_locked(v_bot, p_room_id, false);

  -- Re-checked under the room lock taken by the join.
  perform public._require_active_member(p_room_id, v_uid);
  if (select host_id from public.rooms where id = p_room_id) is distinct from v_uid then
    raise exception using errcode = 'P0001', message = 'not_host';
  end if;

  return jsonb_build_object('user_id', v_bot, 'username', (select username from public.profiles where id = v_bot));
end;
$$;

create or replace function public.leave_room(p_room_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
begin
  perform public._lock_user(v_uid);
  perform public._lock_room(p_room_id);
  perform public._require_in_room(p_room_id, v_uid);
  perform public._leave_room_locked(p_room_id, v_uid);
  perform public._bump(p_room_id);
end;
$$;

create or replace function public.send_chat(p_room_id uuid, p_body text) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_id bigint;
begin
  perform public._require_in_room(p_room_id, v_uid);
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

create or replace function public.advance_room(p_room_id uuid) returns jsonb
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
  perform public._require_in_room(r.id, v_uid);
  v_advanced := public._advance_step(r.id);
  if v_advanced then
    v_version := public._bump(r.id);
  end if;
  return jsonb_build_object('advanced', v_advanced, 'version', v_version);
end;
$$;

create or replace function public.touch_room(p_room_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._require_in_room(p_room_id, public._require_uid());
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
    where room_id = r.id and left_at is null and role = 'player' and last_seen_at > public._fresh_cutoff()
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

create or replace function public.vote_kick(p_room_id uuid, p_target uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  r public.rooms;
  c record;
  v_first boolean;
  v_inserted integer;
begin
  if p_target = v_uid then
    raise exception using errcode = 'P0001', message = 'cannot_kick_self';
  end if;
  perform public._lock_user(p_target);
  r := public._lock_room(p_room_id);
  perform public._require_active_member(r.id, v_uid);
  if not public._is_active_in_room(r.id, p_target) then
    raise exception using errcode = 'P0001', message = 'not_in_room';
  end if;
  if exists (
    select 1 from public.room_players
    where room_id = r.id and user_id = p_target and left_at is null and role = 'spectator'
  ) then
    raise exception using errcode = 'P0001', message = 'not_a_player';
  end if;

  delete from public.kick_votes
  where room_id = r.id and target_id = p_target
    and (select min(created_at) from public.kick_votes where room_id = r.id and target_id = p_target)
        <= now() - interval '2 minutes';

  select * into c from public._kick_counts(r.id, p_target);
  if c.eligible < 2 then
    raise exception using errcode = 'P0001', message = 'not_enough_players_to_vote_kick';
  end if;

  v_first := not exists (select 1 from public.kick_votes where room_id = r.id and target_id = p_target);
  insert into public.kick_votes (room_id, target_id, voter_id) values (r.id, p_target, v_uid)
  on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return jsonb_build_object('kicked', false, 'votes', c.votes, 'needed', c.needed);
  end if;

  select * into c from public._kick_counts(r.id, p_target);
  if c.votes >= c.needed then
    perform public._kick_locked(r.id, p_target, true);
    perform public._bump(r.id);
    return jsonb_build_object('kicked', true, 'votes', c.votes, 'needed', c.needed);
  end if;

  if v_first then
    perform public._system_chat(
      r.id,
      format('Vote to kick %s started (%s/%s)', (select display_name from public.profiles where id = p_target), c.votes, c.needed)
    );
  end if;
  perform public._bump(r.id);
  return jsonb_build_object('kicked', false, 'votes', c.votes, 'needed', c.needed);
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
  p_listen_seconds integer default null,
  p_genre text default null
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
  if p_genre is not null and not public._valid_genre(p_genre) then
    raise exception using errcode = 'P0001', message = 'invalid_genre';
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
      listen_seconds = coalesce(p_listen_seconds, listen_seconds),
      genre = coalesce(p_genre, genre)
  where id = r.id;

  if p_mode is distinct from r.mode and p_mode is not null
     or v_mode <> 'premade' and p_produce_seconds is distinct from r.produce_seconds and p_produce_seconds is not null
     or p_listen_seconds is distinct from r.listen_seconds and p_listen_seconds is not null then
    update public.room_players set is_ready = false
    where room_id = r.id and user_id <> v_uid and is_ready;
  end if;
  perform public._promote_spectators(r.id);
  perform public._sync_autostart(r.id, true);

  perform public._bump(r.id);
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
      'genre', r.genre,
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
      where rp.room_id = r.id and rp.left_at is null and rp.role = 'player' and rp.last_seen_at > public._fresh_cutoff()
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
        'is_bot', p.is_bot,
        'role', rp.role
      ) order by rp.joined_at, rp.user_id)
      from public.room_players rp
      join public.profiles p on p.id = rp.user_id
      where rp.room_id = r.id
        and (
          rp.left_at is null
          or rp.role = 'player'
          or exists (select 1 from public.submissions s where s.room_id = r.id and s.user_id = rp.user_id)
        )
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
          'loudness_lufs', s.loudness_lufs,
          'true_peak_dbtp', s.true_peak_dbtp,
          'loudness_boost', s.loudness_boost,
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
          'loudness_lufs', s.loudness_lufs,
          'true_peak_dbtp', s.true_peak_dbtp,
          'loudness_boost', s.loudness_boost,
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
        'clip_end_ms', public._clip_end_ms(cs, r.listen_seconds),
        'loudness_lufs', cs.loudness_lufs,
        'true_peak_dbtp', cs.true_peak_dbtp,
        'loudness_boost', cs.loudness_boost
      ) order by rr.rank, rr.user_id)
      from public.round_results rr
      join public.submissions cs on cs.id = rr.submission_id
      where rr.room_id = r.id and rr.round = r.round
    ), '[]'::jsonb)
  )
  from public.rooms r
  where r.id = p_room_id;
$$;

create or replace function public.room_heartbeat() returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  v_room_id uuid;
  v_role text;
begin
  update public.room_players rp set last_seen_at = now()
  from public.rooms r
  where r.id = rp.room_id and rp.user_id = v_uid and rp.left_at is null and r.status <> 'closed'
  returning rp.room_id, rp.role into v_room_id, v_role;

  if v_room_id is null then
    return null;
  end if;

  return (
    select jsonb_build_object(
      'id', r.id,
      'code', r.code,
      'name', r.name,
      'mode', r.mode,
      'genre', r.genre,
      'status', r.status,
      'max_players', r.max_players,
      'player_count', pc.fresh,
      'host_username', p.username,
      'host_display_name', p.display_name,
      'role', v_role
    )
    from public.rooms r
    cross join lateral (
      select (count(*) filter (where rp.role = 'player' and rp.last_seen_at > public._fresh_cutoff()))::integer as fresh
      from public.room_players rp
      where rp.room_id = r.id and rp.left_at is null
    ) pc
    left join public.profiles p on p.id = r.host_id
    where r.id = v_room_id
  );
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
    select r.status = 'lobby' as is_open, pc.fresh as players, r.created_at, jsonb_build_object(
      'id', r.id,
      'code', r.code,
      'name', r.name,
      'mode', r.mode,
      'genre', r.genre,
      'status', r.status,
      'max_players', r.max_players,
      'player_count', pc.fresh,
      'spectator_count', pc.spectators,
      'host_username', p.username,
      'host_display_name', p.display_name,
      'round', r.round,
      'phase_ends_at', r.phase_ends_at,
      'estimated_end_at', public._estimated_end_at(r),
      'joinable', r.status = 'lobby' and pc.active < r.max_players,
      'created_at', r.created_at
    ) as room
    from public.rooms r
    cross join lateral (
      select (count(*) filter (where rp.role = 'player'))::integer as active,
             (count(*) filter (where rp.role = 'player' and rp.last_seen_at > public._fresh_cutoff()))::integer as fresh,
             (count(*) filter (where rp.role = 'spectator'))::integer as spectators
      from public.room_players rp
      where rp.room_id = r.id and rp.left_at is null
    ) pc
    left join public.profiles p on p.id = r.host_id
    where not r.is_private and r.status <> 'closed' and (r.status <> 'lobby' or pc.fresh > 0)
    order by r.status = 'lobby' desc, pc.fresh desc, r.created_at
    limit 100
  ) x;
$$;

create or replace function public.sweep_rooms() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_user_id uuid;
  v_status text;
  v_count integer := 0;
begin
  for v_room_id in
    select id from public.rooms
    where status in ('producing', 'listening', 'reviewing', 'results') and phase_ends_at <= now()
    union all
    select id from public.rooms where status = 'lobby' and autostart_at <= now()
    union all
    select r.id from public.rooms r where r.status = 'listening' and r.phase_ends_at > now() and public._skip_reached(r)
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
    where rp.left_at is null and rp.last_seen_at <= public._lobby_idle_cutoff()
      and (r.status = 'lobby' or (rp.role = 'spectator' and r.status <> 'closed'))
    order by rp.room_id, rp.joined_at
  loop
    begin
      if pg_try_advisory_xact_lock(hashtextextended('room_membership:' || v_user_id::text, 0)) then
        select status into v_status from public.rooms where id = v_room_id for update skip locked;
        if found and exists (
          select 1 from public.room_players
          where room_id = v_room_id and user_id = v_user_id
            and left_at is null and last_seen_at <= public._lobby_idle_cutoff()
            and (v_status = 'lobby' or (role = 'spectator' and v_status <> 'closed'))
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

revoke execute on function
  public._max_spectators(),
  public._require_in_room(uuid, uuid),
  public._promote_spectators(uuid),
  public._join_room_locked(uuid, uuid, boolean)
from public, anon, authenticated;
