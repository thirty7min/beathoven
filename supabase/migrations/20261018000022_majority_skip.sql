create function public._skip_voters(p_room public.rooms) returns setof uuid
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
    and rp.last_seen_at > public._fresh_cutoff()
    and not p.is_bot;
$$;

create or replace function public._skip_counts(p_room public.rooms, out votes integer, out needed integer, out eligible integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*)::integer from public.track_skips k
     where k.submission_id = (select s.id from public._current_submission(p_room) s)
       and k.user_id in (select public._skip_voters(p_room))),
    (select count(*)::integer / 2 + 1 from public._skip_voters(p_room)),
    (select count(*)::integer from public._skip_voters(p_room));
$$;

create or replace function public.skip_track(p_room_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  r public.rooms := public._lock_room(p_room_id);
  v_sub public.submissions;
  v_inserted integer;
  v_counts record;
  v_advanced boolean := false;
begin
  perform public._require_active_member(r.id, v_uid);
  if r.status <> 'listening' then
    raise exception using errcode = 'P0001', message = 'wrong_phase';
  end if;
  if now() >= r.phase_ends_at then
    raise exception using errcode = 'P0001', message = 'deadline_passed';
  end if;
  v_sub := public._current_submission(r);
  if v_sub.id is null then
    raise exception using errcode = 'P0001', message = 'wrong_phase';
  end if;

  insert into public.track_skips (room_id, round, submission_id, user_id)
  values (r.id, r.round, v_sub.id, v_uid)
  on conflict do nothing;
  get diagnostics v_inserted = row_count;

  select * into v_counts from public._skip_counts(r);
  if v_inserted > 0 then
    v_advanced := public._advance_step(r.id);
    perform public._bump(r.id);
  end if;
  return jsonb_build_object('skipped', v_advanced, 'votes', v_counts.votes, 'needed', v_counts.needed);
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

revoke execute on function public._skip_voters(public.rooms) from public, anon, authenticated;
