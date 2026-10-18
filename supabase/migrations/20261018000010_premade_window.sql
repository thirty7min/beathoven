-- Premade mode isn't timed production: players upload a finished track, so
-- the window is always 180s (plus the usual 15s upload grace), whatever
-- produce_seconds says. Premade rooms store produce_seconds = 180 so
-- snapshots show the real window; passed produce values are ignored (no error,
-- no ready reset). Leaving premade restores the 1200s default unless the same
-- call passes a produce value. estimated_end_at follows automatically: while
-- producing it builds on phase_ends_at, which start_game now sets from the
-- effective window.

create function public._produce_seconds(p_mode text, p_produce_seconds integer) returns integer
language sql
immutable
set search_path = ''
as $$
  select case when p_mode = 'premade' then 180 else p_produce_seconds end;
$$;

update public.rooms set produce_seconds = 180 where mode = 'premade' and produce_seconds <> 180;

-- Premade rooms store 180 and skip produce validation; otherwise identical to
-- 20261018000007. Covers create_room and quick_match.
create or replace function public._create_room_locked(
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
     or (p_mode <> 'premade' and p_produce_seconds not between 60 and 7200)
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
    values (
      public._generate_room_code(), v_name, p_uid, p_mode, p_max_players,
      public._produce_seconds(p_mode, p_produce_seconds), p_vote_seconds, p_is_private
    )
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

-- Premade pins produce_seconds to 180; leaving premade restores 1200 unless a
-- produce value is passed. Otherwise identical to 20261018000008.
create or replace function public.update_room_settings(
  p_room_id uuid,
  p_name text default null,
  p_max_players integer default null,
  p_produce_seconds integer default null,
  p_vote_seconds integer default null, -- deprecated, ignored
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

  -- Players readied up for different rules; cosmetic changes keep ready.
  if p_mode is distinct from r.mode and p_mode is not null
     or v_mode <> 'premade' and p_produce_seconds is distinct from r.produce_seconds and p_produce_seconds is not null
     or p_listen_seconds is distinct from r.listen_seconds and p_listen_seconds is not null then
    update public.room_players set is_ready = false
    where room_id = r.id and user_id <> v_uid and is_ready;
  end if;

  perform public._bump(r.id);
end;
$$;

-- Uses the effective produce window; otherwise identical to 20261018000008.
create or replace function public.start_game(p_room_id uuid, p_force boolean default false) returns void
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
  if (
    select count(*) from public.room_players
    where room_id = r.id and left_at is null and last_seen_at > public._fresh_cutoff()
  ) < 2 then
    raise exception using errcode = 'P0001', message = 'not_enough_players';
  end if;
  if not coalesce(p_force, false) and exists (
    select 1 from public.room_players
    where room_id = r.id and left_at is null and last_seen_at > public._fresh_cutoff()
      and not is_ready and user_id <> r.host_id
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
      phase_ends_at = now() + make_interval(secs => public._produce_seconds(r.mode, r.produce_seconds) + 15)
  where id = r.id;

  perform public._bump(r.id);
end;
$$;

revoke execute on function public._produce_seconds(text, integer) from public, anon, authenticated;
