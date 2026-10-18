alter table public.submissions
  add column confirmed boolean not null default true,
  add column clip_start_ms integer,
  add column clip_end_ms integer,
  add constraint submissions_clip check (
    (clip_start_ms is null) = (clip_end_ms is null)
    and (clip_start_ms is null or (clip_start_ms >= 0 and clip_end_ms > clip_start_ms and clip_end_ms <= duration_ms))
  );

alter table public.submissions alter column confirmed set default false;

create function public._clip_start_ms(p_submission public.submissions) returns integer
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_submission.clip_start_ms, 0);
$$;

create function public._clip_end_ms(p_submission public.submissions, p_listen_seconds integer) returns integer
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_submission.clip_end_ms, least(p_submission.duration_ms, p_listen_seconds * 1000));
$$;

create function public._clip_play_ms(p_submission public.submissions, p_listen_seconds integer) returns integer
language sql
immutable
set search_path = ''
as $$
  select greatest(
    0,
    least(
      public._clip_end_ms(p_submission, p_listen_seconds) - public._clip_start_ms(p_submission),
      p_listen_seconds * 1000
    )
  );
$$;

create or replace function public._all_submitted(p_room public.rooms) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.room_players
      where room_id = p_room.id and left_at is null and last_seen_at > public._fresh_cutoff()
    )
    and not exists (
      select 1 from public.room_players rp
      where rp.room_id = p_room.id and rp.left_at is null and rp.last_seen_at > public._fresh_cutoff()
        and not exists (
          select 1 from public.submissions s
          where s.room_id = p_room.id and s.round = p_room.round and s.user_id = rp.user_id and s.confirmed
        )
    );
$$;

create function public._save_clip(p_room_id uuid, p_clip_start_ms integer, p_clip_end_ms integer, p_confirm boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  r public.rooms := public._lock_room(p_room_id);
  s public.submissions;
  v_length integer := p_clip_end_ms - p_clip_start_ms;
begin
  perform public._require_active_member(r.id, v_uid);
  if r.status <> 'producing' then
    raise exception using errcode = 'P0001', message = 'wrong_phase';
  end if;
  if now() >= r.phase_ends_at then
    raise exception using errcode = 'P0001', message = 'deadline_passed';
  end if;
  select * into s from public.submissions
  where room_id = r.id and round = r.round and user_id = v_uid
  for update;
  if s.id is null then
    raise exception using errcode = 'P0001', message = 'upload_missing';
  end if;
  if p_clip_start_ms is null or p_clip_end_ms is null
     or p_clip_start_ms < 0 or p_clip_end_ms > s.duration_ms or v_length <= 0
     or v_length > r.listen_seconds * 1000 or v_length < least(10000, s.duration_ms) then
    raise exception using errcode = 'P0001', message = 'invalid_clip';
  end if;

  update public.submissions
  set clip_start_ms = p_clip_start_ms,
      clip_end_ms = p_clip_end_ms,
      confirmed = confirmed or p_confirm
  where id = s.id;

  if p_confirm and not s.confirmed then
    perform public._advance_step(r.id);
    perform public._bump(r.id);
  end if;
  return jsonb_build_object(
    'submission_id', s.id,
    'clip_start_ms', p_clip_start_ms,
    'clip_end_ms', p_clip_end_ms,
    'confirmed', s.confirmed or p_confirm
  );
end;
$$;

create function public.confirm_submission(p_room_id uuid, p_clip_start_ms integer, p_clip_end_ms integer) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public._save_clip(p_room_id, p_clip_start_ms, p_clip_end_ms, true);
$$;

create function public.set_submission_clip(p_room_id uuid, p_clip_start_ms integer, p_clip_end_ms integer) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public._save_clip(p_room_id, p_clip_start_ms, p_clip_end_ms, false);
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
  select public._clip_play_ms(s, r.listen_seconds) into v_play_ms
  from public.submissions s where s.id = r.track_order[p_index + 1];
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
        secs => 3 + public._clip_play_ms(s, p_room.listen_seconds) / 1000.0
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
          + coalesce(avg(public._clip_play_ms(s, p_room.listen_seconds)), p_room.listen_seconds * 1000) / 1000.0
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
      else r.track_started_at + make_interval(secs => public._clip_play_ms(v_sub, r.listen_seconds) / 1000.0)
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

  if v_inserted then
    perform public._bump(r.id);
  end if;
end;
$$;

create or replace function public.submit_track(p_room_id uuid, p_upload_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  r public.rooms := public._lock_room(p_room_id);
  u public.uploads;
  v_previous text;
  v_submission_id uuid;
begin
  perform public._require_active_member(r.id, v_uid);
  if r.status <> 'producing' then
    raise exception using errcode = 'P0001', message = 'wrong_phase';
  end if;
  if now() >= r.phase_ends_at then
    raise exception using errcode = 'P0001', message = 'deadline_passed';
  end if;
  select * into u from public.uploads
  where id = p_upload_id and user_id = v_uid and kind = 'submission' and room_id = r.id and round = r.round;
  if u.id is null or u.status <> 'verified' or u.final_path is null then
    raise exception using errcode = 'P0001', message = 'upload_not_verified';
  end if;

  select storage_path into v_previous from public.submissions
  where room_id = r.id and round = r.round and user_id = v_uid;
  if v_previous = u.final_path then
    v_previous := null;
  end if;

  insert into public.submissions (room_id, round, user_id, storage_path, duration_ms)
  values (r.id, r.round, v_uid, u.final_path, u.duration_ms)
  on conflict (room_id, round, user_id) do update
  set storage_path = excluded.storage_path,
      duration_ms = excluded.duration_ms,
      submitted_at = now(),
      confirmed = false,
      clip_start_ms = null,
      clip_end_ms = null
  returning id into v_submission_id;

  perform public._advance_step(r.id);
  perform public._bump(r.id);
  return jsonb_build_object('submission_id', v_submission_id, 'replaced_path', v_previous);
end;
$$;

create or replace function public._dev_bots_act() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.dev_tools_enabled() then
    return null;
  end if;

  if new.status = 'producing' then
    insert into public.submissions (room_id, round, user_id, storage_path, duration_ms, confirmed, clip_start_ms, clip_end_ms)
    select new.id, new.round, b.user_id, b.storage_path, b.duration_ms, true, 0, least(b.duration_ms, new.listen_seconds * 1000)
    from public.room_players rp
    join public.dev_bots b on b.user_id = rp.user_id
    where rp.room_id = new.id and rp.left_at is null
    on conflict (room_id, round, user_id) do nothing;
  elsif new.status = 'listening' and new.current_track is not null then
    insert into public.votes (room_id, round, submission_id, voter_id, score)
    select new.id, new.round, s.id, b.user_id, 1 + floor(random() * 5)::integer
    from public._current_submission(new) s
    join public.room_players rp on rp.room_id = new.id and rp.left_at is null and rp.user_id <> s.user_id
    join public.dev_bots b on b.user_id = rp.user_id
    where s.id is not null
    on conflict (submission_id, voter_id) do nothing;
  end if;
  return null;
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
      when r.status = 'listening' then coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', s.id,
          'user_id', case when r.reveal_names and t.ord <= r.current_track + 1 then s.user_id end,
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
      when r.status = 'listening' and not r.reveal_names then '[]'::jsonb
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
  public._clip_start_ms(public.submissions),
  public._clip_end_ms(public.submissions, integer),
  public._clip_play_ms(public.submissions, integer),
  public._save_clip(uuid, integer, integer, boolean)
from public, anon, authenticated;

revoke execute on function
  public.confirm_submission(uuid, integer, integer),
  public.set_submission_clip(uuid, integer, integer)
from public, anon;

grant execute on function
  public.confirm_submission(uuid, integer, integer),
  public.set_submission_clip(uuid, integer, integer)
to authenticated;
