create function public._lobby_idle_cutoff() returns timestamptz
language sql
stable
set search_path = ''
as $$
  select now() - interval '30 seconds';
$$;

create function public.room_heartbeat() returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  v_room_id uuid;
begin
  update public.room_players rp set last_seen_at = now()
  from public.rooms r
  where r.id = rp.room_id and rp.user_id = v_uid and rp.left_at is null and r.status <> 'closed'
  returning rp.room_id into v_room_id;

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
      'host_display_name', p.display_name
    )
    from public.rooms r
    cross join lateral (
      select (count(*) filter (where rp.last_seen_at > public._fresh_cutoff()))::integer as fresh
      from public.room_players rp
      where rp.room_id = r.id and rp.left_at is null
    ) pc
    left join public.profiles p on p.id = r.host_id
    where r.id = v_room_id
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
    where r.status = 'lobby' and rp.left_at is null and rp.last_seen_at <= public._lobby_idle_cutoff()
    order by rp.room_id, rp.joined_at
  loop
    begin
      if pg_try_advisory_xact_lock(hashtextextended('room_membership:' || v_user_id::text, 0)) then
        perform 1 from public.rooms where id = v_room_id and status = 'lobby' for update skip locked;
        if found and exists (
          select 1 from public.room_players
          where room_id = v_room_id and user_id = v_user_id
            and left_at is null and last_seen_at <= public._lobby_idle_cutoff()
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

revoke execute on function public._lobby_idle_cutoff() from public, anon, authenticated;
revoke execute on function public.room_heartbeat() from public, anon;
grant execute on function public.room_heartbeat() to authenticated;
