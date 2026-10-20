alter table public.room_players
  add column leave_pending_at timestamptz,
  add column tab_id text;

alter table public.rooms add column game_started_at timestamptz;

create function public._leave_pending_grace() returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '8 seconds';
$$;

create or replace function public._lobby_idle_cutoff() returns timestamptz
language sql
stable
set search_path = ''
as $$
  select now() - interval '90 seconds';
$$;

create function public._clear_leave_pending() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.leave_pending_at := null;
  return new;
end;
$$;

create trigger room_players_clear_leave_pending
before update of last_seen_at, left_at on public.room_players
for each row
execute function public._clear_leave_pending();

create function public._reapable(p_member public.room_players, p_status text) returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    p_member.left_at is null
    and p_status <> 'closed'
    and (
      p_member.leave_pending_at <= now() - public._leave_pending_grace()
      or (
        (p_status = 'lobby' or p_member.role = 'spectator')
        and p_member.last_seen_at <= public._lobby_idle_cutoff()
      )
    ),
    false
  );
$$;

drop function public.room_heartbeat();

create function public.room_heartbeat(p_tab_id text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  v_room_id uuid;
  v_role text;
begin
  update public.room_players rp set last_seen_at = now(), tab_id = coalesce(left(p_tab_id, 64), rp.tab_id)
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

-- A refreshed page beats under a new tab id before this lands, so a stale tab's beacon is ignored.
create function public.mark_leave_pending(p_tab_id text default null) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  v_room_id uuid;
begin
  select rp.room_id into v_room_id
  from public.room_players rp
  join public.rooms r on r.id = rp.room_id
  where rp.user_id = v_uid and rp.left_at is null and r.status <> 'closed';
  if v_room_id is null then
    return false;
  end if;

  perform public._lock_room(v_room_id);
  update public.room_players set leave_pending_at = now()
  where room_id = v_room_id and user_id = v_uid and left_at is null and leave_pending_at is null
    and (p_tab_id is null or tab_id is null or tab_id = left(p_tab_id, 64));
  if not found then
    return false;
  end if;
  perform public._bump(v_room_id);
  return true;
end;
$$;

create function public.reap_member(p_room_id uuid, p_user_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  r public.rooms;
  v_member public.room_players;
begin
  perform public._lock_user(p_user_id);
  r := public._lock_room(p_room_id);
  perform public._require_in_room(r.id, v_uid);

  select * into v_member from public.room_players where room_id = r.id and user_id = p_user_id and left_at is null for update;
  if not found or r.status = 'closed' then
    return jsonb_build_object('removed', false, 'retry_in_ms', null);
  end if;

  if public._reapable(v_member, r.status) then
    perform public._leave_room_locked(r.id, p_user_id);
    perform public._bump(r.id);
    return jsonb_build_object('removed', true, 'retry_in_ms', null);
  end if;

  return jsonb_build_object(
    'removed', false,
    'retry_in_ms', case when v_member.leave_pending_at is not null then
      greatest(0, ceil(extract(epoch from v_member.leave_pending_at + public._leave_pending_grace() - now()) * 1000))::integer
    end
  );
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
  v_status text;
  v_member public.room_players;
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
    where rp.left_at is null and r.status <> 'closed' and public._reapable(rp, r.status)
    order by rp.room_id, rp.sort_key
  loop
    begin
      if pg_try_advisory_xact_lock(hashtextextended('room_membership:' || v_user_id::text, 0)) then
        select status into v_status from public.rooms where id = v_room_id for update skip locked;
        if found then
          select * into v_member from public.room_players
          where room_id = v_room_id and user_id = v_user_id
          for update;
        end if;
        if found and public._reapable(v_member, v_status) then
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

create or replace function public._join_room_locked(p_uid uuid, p_room_id uuid, p_spectate boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous uuid;
  v_lock_id uuid;
  v_role text;
  v_reseated boolean := false;
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
  elsif r.status = 'producing' and public._active_player_count(r.id) < r.max_players and exists (
    select 1 from public.room_players
    where room_id = r.id and user_id = p_uid and role = 'player' and left_at >= r.phase_started_at
  ) then
    v_role := 'player';
    v_reseated := true;
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

  insert into public.room_players as rp (room_id, user_id, role)
  values (r.id, p_uid, v_role)
  on conflict (room_id, user_id) do update
  set left_at = null, joined_at = now(), last_seen_at = now(), is_ready = false, role = excluded.role,
      sort_key = case when v_reseated then rp.sort_key else excluded.sort_key end;
  delete from public.kick_votes where room_id = r.id and target_id = p_uid;
  if v_role = 'player' then
    perform public._sync_autostart(r.id, true);
  end if;

  return jsonb_build_object('room_id', r.id, 'code', r.code, 'version', public._bump(r.id), 'role', v_role);
end;
$$;

create or replace function public._room_players_json(p_room_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', rp.user_id,
    'username', p.username,
    'display_name', p.display_name,
    'avatar_url', p.avatar_url,
    'joined_at', rp.joined_at,
    'left_at', rp.left_at,
    'last_seen_at', rp.last_seen_at,
    'leave_pending_at', rp.leave_pending_at,
    'is_ready', rp.is_ready,
    'is_bot', p.is_bot,
    'role', rp.role
  ) order by rp.sort_key, rp.user_id), '[]'::jsonb)
  from public.room_players rp
  join public.profiles p on p.id = rp.user_id
  where rp.room_id = p_room_id
    and (
      rp.left_at is null
      or rp.role = 'player'
      or exists (select 1 from public.submissions s where s.room_id = p_room_id and s.user_id = rp.user_id)
    );
$$;

create or replace function public._start_game_locked(p_room public.rooms) returns void
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
      game_started_at = now(),
      phase_started_at = now(),
      phase_ends_at = now() + make_interval(secs => public._produce_seconds(p_room.mode, p_room.produce_seconds) + 15)
  where id = p_room.id;
end;
$$;

create function public._remove_absent_players(p_room_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  for v_user_id in
    select rp.user_id
    from public.room_players rp
    join public.rooms r on r.id = rp.room_id
    join public.profiles p on p.id = rp.user_id
    where rp.room_id = p_room_id and rp.left_at is null and rp.role = 'player' and not p.is_bot
      and rp.last_seen_at < r.game_started_at
    order by rp.sort_key
  loop
    -- The room lock is already held, so waiting on the user lock could invert the user-then-room order.
    if pg_try_advisory_xact_lock(hashtextextended('room_membership:' || v_user_id::text, 0)) then
      perform public._leave_room_locked(p_room_id, v_user_id);
    end if;
  end loop;
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
  perform public._remove_absent_players(p_room_id);
  perform public._promote_spectators(p_room_id);
end;
$$;

revoke execute on function
  public._leave_pending_grace(),
  public._remove_absent_players(uuid),
  public._clear_leave_pending(),
  public._reapable(public.room_players, text)
from public, anon, authenticated;

revoke execute on function
  public.room_heartbeat(text),
  public.mark_leave_pending(text),
  public.reap_member(uuid, uuid)
from public, anon;
grant execute on function
  public.room_heartbeat(text),
  public.mark_leave_pending(text),
  public.reap_member(uuid, uuid)
to authenticated;
