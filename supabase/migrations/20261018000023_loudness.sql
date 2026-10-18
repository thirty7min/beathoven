alter table public.submissions
  add column loudness_lufs real constraint submissions_loudness_lufs check (loudness_lufs between -100 and 30),
  add column true_peak_dbtp real constraint submissions_true_peak_dbtp check (true_peak_dbtp between -150 and 40),
  add column loudness_status text not null default 'pending'
    constraint submissions_loudness_status check (loudness_status in ('pending', 'done', 'failed')),
  add column loudness_attempts smallint not null default 0,
  add column loudness_boost boolean not null default true;

update public.submissions set loudness_boost = false, loudness_status = 'failed' where storage_path like 'bots/%';

create index submissions_loudness_pending_idx on public.submissions (submitted_at desc) where loudness_status = 'pending';

create function public.record_submission_loudness(
  p_submission_id uuid,
  p_storage_path text,
  p_ok boolean,
  p_lufs real default null,
  p_true_peak real default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_ok then
    update public.submissions
    set loudness_lufs = case when p_lufs between -100 and 30 then p_lufs end,
        true_peak_dbtp = case when p_true_peak between -150 and 40 then p_true_peak end,
        loudness_status = 'done',
        loudness_attempts = loudness_attempts + 1
    where id = p_submission_id and storage_path = p_storage_path;
  else
    update public.submissions
    set loudness_attempts = loudness_attempts + 1,
        loudness_status = case when loudness_attempts + 1 >= 3 then 'failed' else 'pending' end
    where id = p_submission_id and storage_path = p_storage_path and loudness_status <> 'done';
  end if;
  return found;
end;
$$;

create function public.loudness_retry_candidates(p_limit integer default 5)
returns table (submission_id uuid, storage_path text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.storage_path
  from public.submissions s
  where s.loudness_status = 'pending'
    and s.purged_at is null
    and s.storage_path not like 'bots/%'
    and s.submitted_at < now() - interval '2 minutes'
  order by s.submitted_at desc
  limit p_limit;
$$;

drop function public.confirm_submission(uuid, integer, integer, smallint[]);
drop function public.set_submission_clip(uuid, integer, integer, smallint[]);
drop function public._save_clip(uuid, integer, integer, boolean, smallint[]);

create or replace function public.submissions_track_upkeep() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public._refresh_track(old.track_id);
    return null;
  end if;

  if tg_op = 'UPDATE' and tg_when = 'BEFORE' then
    if new.storage_path is distinct from old.storage_path then
      new.track_id := null;
      new.match_source := null;
      new.match_score := null;
      new.peaks := null;
      new.loudness_lufs := null;
      new.true_peak_dbtp := null;
      new.loudness_status := 'pending';
      new.loudness_attempts := 0;
      new.loudness_boost := true;
    end if;
    return new;
  end if;

  if new.storage_path is distinct from old.storage_path then
    delete from public.submission_fingerprints where submission_id = new.id;
    delete from public.track_suggestions where submission_id = new.id;
  end if;
  if new.track_id is distinct from old.track_id then
    perform public._refresh_track(old.track_id);
    perform public._refresh_track(new.track_id);
  end if;
  return null;
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
    insert into public.submissions (
      room_id, round, user_id, storage_path, duration_ms, confirmed, clip_start_ms, clip_end_ms, loudness_boost, loudness_status
    )
    select new.id, new.round, b.user_id, b.storage_path, b.duration_ms, true, 0, least(b.duration_ms, new.listen_seconds * 1000), false, 'failed'
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

create function public._save_clip(p_room_id uuid, p_clip_start_ms integer, p_clip_end_ms integer, p_confirm boolean, p_peaks smallint[], p_loudness_boost boolean)
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
  if not public._valid_peaks(p_peaks) then
    raise exception using errcode = 'P0001', message = 'invalid_peaks';
  end if;

  update public.submissions
  set clip_start_ms = p_clip_start_ms,
      clip_end_ms = p_clip_end_ms,
      confirmed = confirmed or p_confirm,
      peaks = coalesce(p_peaks, peaks),
      loudness_boost = coalesce(p_loudness_boost, loudness_boost)
  where id = s.id;

  if p_confirm and not s.confirmed then
    perform public._advance_step(r.id);
    perform public._bump(r.id);
  end if;
  return jsonb_build_object(
    'submission_id', s.id,
    'clip_start_ms', p_clip_start_ms,
    'clip_end_ms', p_clip_end_ms,
    'confirmed', s.confirmed or p_confirm,
    'loudness_boost', coalesce(p_loudness_boost, s.loudness_boost)
  );
end;
$$;

create function public.confirm_submission(p_room_id uuid, p_clip_start_ms integer, p_clip_end_ms integer, p_peaks smallint[] default null, p_loudness_boost boolean default null) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public._save_clip(p_room_id, p_clip_start_ms, p_clip_end_ms, true, p_peaks, p_loudness_boost);
$$;

create function public.set_submission_clip(p_room_id uuid, p_clip_start_ms integer, p_clip_end_ms integer, p_peaks smallint[] default null, p_loudness_boost boolean default null) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public._save_clip(p_room_id, p_clip_start_ms, p_clip_end_ms, false, p_peaks, p_loudness_boost);
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
        'clip_end_ms', public._clip_end_ms(s, r.listen_seconds),
        'loudness_lufs', s.loudness_lufs,
        'true_peak_dbtp', s.true_peak_dbtp,
        'loudness_boost', s.loudness_boost
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
        'loudness_lufs', s.loudness_lufs,
        'true_peak_dbtp', s.true_peak_dbtp,
        'loudness_boost', s.loudness_boost,
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
          'id', c.id, 'room_id', c.room_id, 'user_id', c.user_id, 'username', p.username, 'display_name', p.display_name,
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

create or replace function public.get_profile_tracks(p_username text, p_sort text default 'wins', p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_sort text := case when p_sort in ('wins', 'win_rate', 'plays', 'recent') then p_sort else 'wins' end;
begin
  select id into v_user_id from public.profiles where lower(username) = lower(btrim(p_username));
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'profile_not_found';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', st.id,
      'title', st.title,
      'games', st.games,
      'plays', st.plays,
      'wins', st.wins,
      'win_rate', st.win_rate,
      'avg_rating', st.avg_rating,
      'best_finish', st.best_finish,
      'last_played_at', st.last_played_at,
      'latest_submission_id', pub.id,
      'duration_ms', pub.duration_ms,
      'clip_start_ms', pub.clip_start_ms,
      'clip_end_ms', pub.clip_end_ms,
      'peaks', to_jsonb(pub.peaks),
      'loudness_lufs', pub.loudness_lufs,
      'true_peak_dbtp', pub.true_peak_dbtp,
      'loudness_boost', pub.loudness_boost,
      'playable', pub.id is not null
    ) order by st.ord)
    from (
      select agg.*,
        row_number() over (order by
          case v_sort when 'wins' then agg.wins when 'plays' then agg.plays end desc nulls last,
          case when v_sort = 'win_rate' then agg.win_rate end desc nulls last,
          case when v_sort = 'recent' then agg.last_played_at end desc nulls last,
          agg.wins desc, agg.win_rate desc, agg.games desc, agg.last_played_at desc, agg.id
        ) as ord
      from (
        select t.id, t.title,
          count(*)::integer as games,
          sum(rr.vote_count)::integer as plays,
          (count(*) filter (where rr.is_winner))::integer as wins,
          round((count(*) filter (where rr.is_winner))::numeric / count(*), 4) as win_rate,
          (
            select round(avg(v.score)::numeric, 2)
            from public.votes v
            join public.submissions vs on vs.id = v.submission_id
            where vs.track_id = t.id
              and exists (select 1 from public.round_results x where x.submission_id = vs.id)
          ) as avg_rating,
          min(rr.rank)::integer as best_finish,
          max(rr.finished_at) as last_played_at
        from public.tracks t
        join public.submissions s on s.track_id = t.id
        join public.round_results rr on rr.submission_id = s.id and rr.user_id = t.user_id
        where t.user_id = v_user_id
        group by t.id, t.title
      ) agg
      order by ord
      limit least(greatest(coalesce(p_limit, 50), 1), 100)
    ) st
    cross join lateral public._track_public_submission(st.id) pub
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_track_stream(p_track_id uuid, p_requester text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.submissions;
begin
  if p_track_id is null or nullif(btrim(p_requester), '') is null then
    raise exception using errcode = 'P0001', message = 'invalid_request';
  end if;
  delete from public.track_stream_requests where created_at <= now() - interval '1 minute';
  if (select count(*) from public.track_stream_requests where requester = p_requester) >= 30 then
    raise exception using errcode = 'P0001', message = 'stream_rate_limited';
  end if;
  insert into public.track_stream_requests (requester) values (p_requester);

  if not exists (select 1 from public.tracks where id = p_track_id) then
    raise exception using errcode = 'P0001', message = 'track_not_found';
  end if;
  s := public._track_public_submission(p_track_id);
  if s.id is null then
    raise exception using errcode = 'P0001', message = 'track_not_playable';
  end if;
  return jsonb_build_object(
    'submission_id', s.id,
    'storage_path', s.storage_path,
    'duration_ms', s.duration_ms,
    'clip_start_ms', s.clip_start_ms,
    'clip_end_ms', s.clip_end_ms,
    'loudness_lufs', s.loudness_lufs,
    'true_peak_dbtp', s.true_peak_dbtp,
    'loudness_boost', s.loudness_boost
  );
end;
$$;

revoke execute on function
  public.record_submission_loudness(uuid, text, boolean, real, real),
  public.loudness_retry_candidates(integer),
  public._save_clip(uuid, integer, integer, boolean, smallint[], boolean)
from public, anon, authenticated;

grant execute on function
  public.record_submission_loudness(uuid, text, boolean, real, real),
  public.loudness_retry_candidates(integer)
to service_role;

revoke execute on function
  public.confirm_submission(uuid, integer, integer, smallint[], boolean),
  public.set_submission_clip(uuid, integer, integer, smallint[], boolean)
from public, anon;

grant execute on function
  public.confirm_submission(uuid, integer, integer, smallint[], boolean),
  public.set_submission_clip(uuid, integer, integer, smallint[], boolean)
to authenticated;
