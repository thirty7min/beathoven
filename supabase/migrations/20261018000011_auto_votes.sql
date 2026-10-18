alter table public.votes add column is_default boolean not null default false;
alter table public.rooms add column closed_track_id uuid;
alter table public.rooms add column closed_track_at timestamptz;

create function public._vote_tolerance() returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '1.5 seconds';
$$;

create function public._apply_default_votes(p_room public.rooms) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.votes (room_id, round, submission_id, voter_id, score, is_default)
  select p_room.id, p_room.round, cur.id, e.user_id, 3, true
  from public._current_submission(p_room) cur
  cross join public._eligible_voters(p_room) e(user_id)
  where cur.id is not null
  on conflict (submission_id, voter_id) do nothing;
$$;

create or replace function public._start_track(p_room_id uuid, p_index integer) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.rooms;
  v_play_ms integer;
  v_starts_at timestamptz := now() + interval '3 seconds';
begin
  select * into r from public.rooms where id = p_room_id;
  select public._play_ms(duration_ms, r.listen_seconds) into v_play_ms
  from public.submissions where id = r.track_order[p_index + 1];
  update public.rooms
  set status = 'listening',
      current_track = p_index,
      track_started_at = v_starts_at,
      phase_started_at = now(),
      phase_ends_at = v_starts_at + make_interval(secs => v_play_ms / 1000.0)
  where id = p_room_id;
end;
$$;

create or replace function public._estimated_end_at(p_room public.rooms) returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case p_room.status
    when 'results' then p_room.phase_ends_at
    when 'listening' then p_room.phase_ends_at + interval '30 seconds' + coalesce((
      select sum(make_interval(
        secs => 3 + public._play_ms(s.duration_ms, p_room.listen_seconds) / 1000.0
      ))
      from unnest(p_room.track_order) with ordinality as t(id, ord)
      join public.submissions s on s.id = t.id
      where t.ord > p_room.current_track + 1
    ), interval '0')
    when 'producing' then p_room.phase_ends_at + interval '30 seconds' + (
      select make_interval(secs =>
        greatest(
          (select count(*) from public.room_players where room_id = p_room.id and left_at is null),
          count(*)
        ) * (
          3
          + coalesce(avg(public._play_ms(s.duration_ms, p_room.listen_seconds)), p_room.listen_seconds * 1000) / 1000.0
        )
      )
      from public.submissions s
      where s.room_id = p_room.id and s.round = p_room.round
    )
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
    if now() < r.phase_ends_at and not public._skip_reached(r) then
      return false;
    end if;
    v_current := (public._current_submission(r)).id;
    -- Results can't absorb late votes, so the last track waits out the tolerance first.
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

create or replace function public.cast_vote(p_room_id uuid, p_submission_id uuid, p_score integer) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  r public.rooms := public._lock_room(p_room_id);
  v_sub public.submissions;
  v_closes_at timestamptz;
  v_inserted boolean;
begin
  perform public._require_active_member(r.id, v_uid);
  if r.status <> 'listening' then
    raise exception using errcode = 'P0001', message = 'wrong_phase';
  end if;
  v_sub := public._current_submission(r);
  if v_sub.id is not null and v_sub.id = p_submission_id then
    if now() < r.track_started_at then
      raise exception using errcode = 'P0001', message = 'track_not_started';
    end if;
    v_closes_at := case
      when r.closed_track_id = v_sub.id then r.closed_track_at
      else r.track_started_at + make_interval(secs => public._play_ms(v_sub.duration_ms, r.listen_seconds) / 1000.0)
    end;
  elsif r.closed_track_id = p_submission_id then
    select * into v_sub from public.submissions where id = p_submission_id;
    v_closes_at := r.closed_track_at;
  else
    raise exception using errcode = 'P0001', message = 'not_current_track';
  end if;
  if now() >= v_closes_at + public._vote_tolerance() then
    raise exception using errcode = 'P0001', message = 'deadline_passed';
  end if;
  if p_score is null or p_score not between 1 and 5 then
    raise exception using errcode = 'P0001', message = 'invalid_score';
  end if;
  if v_sub.user_id = v_uid then
    raise exception using errcode = 'P0001', message = 'self_vote';
  end if;

  insert into public.votes (room_id, round, submission_id, voter_id, score)
  values (r.id, r.round, v_sub.id, v_uid, p_score)
  on conflict (submission_id, voter_id) do update set score = excluded.score, is_default = false
  returning (xmax = 0) into v_inserted;

  -- Scores aren't in room state before results, so a changed score needs no broadcast.
  if v_inserted then
    perform public._bump(r.id);
  end if;
end;
$$;

revoke execute on function public._apply_default_votes(public.rooms), public._vote_tolerance()
from public, anon, authenticated;
