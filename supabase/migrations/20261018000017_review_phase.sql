alter table public.rooms drop constraint rooms_status_check;
alter table public.rooms add constraint rooms_status_check
  check (status in ('lobby', 'producing', 'listening', 'reviewing', 'results', 'closed'));

drop index public.rooms_sweep_idx;
create index rooms_sweep_idx on public.rooms (phase_ends_at) where status in ('producing', 'listening', 'reviewing', 'results');

create table public.review_done (
  room_id uuid not null references public.rooms (id) on delete cascade,
  round integer not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (room_id, round, user_id)
);

alter table public.review_done enable row level security;
revoke all on public.review_done from anon, authenticated;

create function public._review_participants(p_room public.rooms) returns setof uuid
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

create function public._review_all_done(p_room public.rooms) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public._review_participants(p_room) u(user_id)
    where not exists (
      select 1 from public.review_done d
      where d.room_id = p_room.id and d.round = p_room.round and d.user_id = u.user_id
    )
  );
$$;

create function public._enter_review(p_room_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.rooms
  set status = 'reviewing',
      current_track = null,
      track_started_at = null,
      phase_started_at = now(),
      phase_ends_at = now() + interval '30 seconds'
  where id = p_room_id;
end;
$$;

create function public.finish_review(p_room_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  r public.rooms := public._lock_room(p_room_id);
  v_inserted boolean := false;
  v_advanced boolean := false;
begin
  perform public._require_active_member(r.id, v_uid);
  if r.status <> 'reviewing' then
    raise exception using errcode = 'P0001', message = 'wrong_phase';
  end if;
  insert into public.review_done (room_id, round, user_id)
  values (r.id, r.round, v_uid)
  on conflict do nothing;
  v_inserted := found;
  if v_inserted then
    v_advanced := public._advance_step(r.id);
    perform public._bump(r.id);
  end if;
  return jsonb_build_object('advanced', v_advanced);
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
        greatest(
          (select count(*) from public.room_players where room_id = p_room.id and left_at is null),
          count(*)
        ) * (
          3
          + coalesce(avg(public._clip_play_ms(s, p_room.listen_seconds)), p_room.listen_seconds * 1000) / 1000.0
        )
      )
      from public.submissions s
      where s.room_id = p_room.id and s.round = p_room.round
    )
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
  if r.status not in ('listening', 'reviewing') then
    raise exception using errcode = 'P0001', message = 'wrong_phase';
  end if;
  if r.status = 'reviewing' then
    select * into v_sub from public.submissions
    where id = p_submission_id and room_id = r.id and round = r.round and id = any(r.track_order);
    if v_sub.id is null then
      raise exception using errcode = 'P0001', message = 'not_current_track';
    end if;
    v_closes_at := 'infinity';
  else
    v_sub := public._current_submission(r);
    if v_sub.id is not null and v_sub.id = p_submission_id then
      if now() < r.track_started_at then
        raise exception using errcode = 'P0001', message = 'track_not_started';
      end if;
      v_closes_at := case
        when r.closed_track_id = v_sub.id then r.closed_track_at
        else r.track_started_at + make_interval(secs => public._clip_play_ms(v_sub, r.listen_seconds) / 1000.0)
      end;
    elsif r.closed_track_id = p_submission_id then
      select * into v_sub from public.submissions where id = p_submission_id;
      v_closes_at := r.closed_track_at;
    else
      raise exception using errcode = 'P0001', message = 'not_current_track';
    end if;
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

  if v_inserted then
    perform public._bump(r.id);
  end if;
end;
$$;

create or replace function public._drop_submission_locked(p_room_id uuid, p_uid uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.rooms;
  v_sub uuid;
  v_index integer;
begin
  select * into r from public.rooms where id = p_room_id;
  if r.status not in ('producing', 'listening', 'reviewing') then
    return;
  end if;
  select id into v_sub from public.submissions where room_id = r.id and round = r.round and user_id = p_uid;
  if v_sub is null then
    return;
  end if;

  if r.status = 'producing' then
    delete from public.submissions where id = v_sub;
    return;
  end if;

  v_index := array_position(r.track_order, v_sub) - 1;
  update public.rooms
  set track_order = array_remove(track_order, v_sub),
      current_track = case when v_index < current_track then current_track - 1 else current_track end,
      closed_track_id = nullif(closed_track_id, v_sub)
  where id = r.id;
  delete from public.submissions where id = v_sub;

  if r.status = 'listening' and v_index = r.current_track then
    if r.current_track < cardinality(r.track_order) - 1 then
      perform public._start_track(r.id, r.current_track);
    else
      perform public._enter_review(r.id);
    end if;
  end if;
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

create or replace function public.can_see_round(p_room_id uuid, p_round integer) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.rooms r
    join public.room_players rp on rp.room_id = r.id and rp.user_id = auth.uid()
    where r.id = p_room_id
      and (
        p_round < r.round
        or r.status in ('lobby', 'closed')
        or (rp.left_at is null and r.status in ('listening', 'reviewing', 'results'))
      )
  );
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
      'track_started_at', r.track_started_at
    ),
    'readiness', (
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

create or replace function public.get_room_snapshot(p_room_id uuid) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  v_round integer;
  v_state jsonb;
  v_my_skips jsonb;
begin
  if exists (select 1 from public.room_bans where room_id = p_room_id and user_id = v_uid) then
    raise exception using errcode = 'P0001', message = 'banned_from_room';
  end if;
  if not exists (select 1 from public.room_players where room_id = p_room_id and user_id = v_uid) then
    raise exception using errcode = 'P0001', message = 'not_member';
  end if;
  update public.room_players set last_seen_at = now()
  where room_id = p_room_id and user_id = v_uid and left_at is null;
  select round into v_round from public.rooms where id = p_room_id;

  v_state := public._room_state(p_room_id);
  v_my_skips := coalesce((
    select jsonb_agg(k.submission_id order by k.created_at)
    from public.track_skips k
    where k.room_id = p_room_id and k.round = v_round and k.user_id = v_uid
  ), '[]'::jsonb);
  if jsonb_typeof(v_state -> 'skip') = 'object' then
    v_state := jsonb_set(v_state, '{skip,you_voted}', to_jsonb(v_my_skips ? (v_state #>> '{skip,submission_id}')));
  end if;

  return v_state || jsonb_build_object(
    'server_time', clock_timestamp(),
    'me', v_uid,
    'my_submission', (
      select jsonb_build_object(
        'id', s.id,
        'user_id', s.user_id,
        'storage_path', s.storage_path,
        'duration_ms', s.duration_ms,
        'submitted_at', s.submitted_at,
        'confirmed', s.confirmed,
        'clip_start_ms', public._clip_start_ms(s),
        'clip_end_ms', public._clip_end_ms(s, r.listen_seconds)
      )
      from public.submissions s
      join public.rooms r on r.id = s.room_id
      where s.room_id = p_room_id and s.round = v_round and s.user_id = v_uid
    ),
    'my_skip_votes', v_my_skips,
    'my_review', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'submission_id', s.id,
        'position', t.ord,
        'duration_ms', s.duration_ms,
        'clip_start_ms', public._clip_start_ms(s),
        'clip_end_ms', public._clip_end_ms(s, r.listen_seconds),
        'is_mine', s.user_id = v_uid,
        'my_vote', v.score,
        'is_default', coalesce(v.is_default, false)
      ) order by t.ord), '[]'::jsonb)
      from public.rooms r
      cross join lateral unnest(r.track_order) with ordinality as t(id, ord)
      join public.submissions s on s.id = t.id
      left join public.votes v on v.submission_id = s.id and v.voter_id = v_uid
      where r.id = p_room_id and r.status = 'reviewing'
    ),
    'my_kick_votes', coalesce((
      select jsonb_agg(k.target_id order by k.created_at)
      from public.kick_votes k
      where k.room_id = p_room_id and k.voter_id = v_uid
        and public._is_active_in_room(p_room_id, k.target_id)
        and (select c.expires_at from public._kick_counts(p_room_id, k.target_id) c) is not null
    ), '[]'::jsonb),
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
          'body', c.body, 'kind', c.kind, 'created_at', c.created_at
        ) as msg
        from public.chat_messages c
        left join public.profiles p on p.id = c.user_id
        where c.room_id = p_room_id
        order by c.id desc
        limit 50
      ) m
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function
  public._review_participants(public.rooms),
  public._review_all_done(public.rooms),
  public._enter_review(uuid)
from public, anon, authenticated;

revoke execute on function public.finish_review(uuid) from public, anon;
grant execute on function public.finish_review(uuid) to authenticated;
