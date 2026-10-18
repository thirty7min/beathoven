-- Blind listening (reveal_names), vote-to-skip, a per-room listen cap,
-- opaque upload paths, member heartbeats and state machine hardening.
--
-- Listen cap: every track plays at most listen_seconds (from 0:00), whatever
-- its uploaded length; the schedule uses least(duration_ms, listen_seconds *
-- 1000) ("clip").
--
-- Voting happens while the track plays: votes are accepted from
-- track_started_at (after the 3s lead-in) until clip end + 5s grace, then the
-- next track starts. If every eligible voter has rated by clip end the grace
-- is skipped, but a track is never cut short for early votes; only
-- vote-to-skip ends a track early. rooms.vote_seconds is deprecated: kept for
-- compatibility, always 20 for new rooms, ignored by scheduling and settings.
--
-- Identity model: until a round reaches results, nothing a client can read
-- links a track to its producer unless the room has reveal_names on.
--   * Broadcasts/snapshots: producing lists no submissions (only who has
--     submitted); listening lists tracks in play order without user_id or
--     submitted_at (reveal_names adds user_id for current and played tracks);
--     votes_cast is withheld while listening blind. Each player gets their own
--     entry privately in the snapshot (my_submission).
--   * Table reads: other players' submissions rows are hidden until the round
--     is over.
--   * Storage: uploads go to `<room>/<round>/<random uuid>.<ext>`, reserved via
--     reserve_upload; storage policies key off the reservation and
--     submissions tables, never a uid in the path.
--
-- Freshness: room_players.last_seen_at is refreshed by touch_room and by every
-- member RPC. Members idle for more than 60s are "stale": in the lobby the
-- sweep removes them through the normal leave logic; during a game they are
-- never removed but stop counting toward "everyone submitted/voted/skipped",
-- readiness and quick-match ranking, so one closed tab can't hold a room
-- hostage. Deadlines still apply to everyone.
--
-- Lock order is unchanged: quick-match mode lock, user lock, rooms by id, then
-- other tables. The sweep only try-locks (skip locked / try advisory lock) so
-- it never waits while holding locks from earlier rooms.

alter table public.rooms add column reveal_names boolean not null default false;
alter table public.rooms add column listen_seconds integer not null default 45
  constraint rooms_listen_seconds_range check (listen_seconds between 30 and 60);

create function public._play_ms(p_duration_ms integer, p_listen_seconds integer) returns integer
language sql
immutable
set search_path = ''
as $$
  select least(p_duration_ms, p_listen_seconds * 1000);
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
      phase_ends_at = v_starts_at + make_interval(secs => v_play_ms / 1000.0 + 5)
  where id = p_room_id;
end;
$$;

-- When the room should be back in the lobby. Exact-ish while listening;
-- during producing it assumes every player submits a track as long as the
-- average so far (or the full listen cap).
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
        secs => 3 + public._play_ms(s.duration_ms, p_room.listen_seconds) / 1000.0 + 5
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
          + 5
        )
      )
      from public.submissions s
      where s.room_id = p_room.id and s.round = p_room.round
    )
  end;
$$;

alter table public.room_players add column last_seen_at timestamptz not null default now();

create function public._fresh_cutoff() returns timestamptz
language sql
stable
set search_path = ''
as $$
  select now() - interval '60 seconds';
$$;

-- Every member RPC goes through this, so it doubles as the heartbeat.
create or replace function public._require_active_member(p_room_id uuid, p_uid uuid) returns void
language plpgsql
volatile
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

create function public.touch_room(p_room_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._require_active_member(p_room_id, public._require_uid());
end;
$$;

-- Upload reservations ---------------------------------------------------------

create table public.submission_uploads (
  path text primary key,
  room_id uuid not null references public.rooms (id) on delete cascade,
  round integer not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index submission_uploads_room_round_idx on public.submission_uploads (room_id, round);

alter table public.submission_uploads enable row level security;
revoke all on public.submission_uploads from anon, authenticated;

create function public.reserve_upload(p_room_id uuid, p_extension text default null) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  r public.rooms;
  v_ext text := lower(regexp_replace(coalesce(p_extension, ''), '[^A-Za-z0-9]', '', 'g'));
  v_path text;
begin
  perform public._require_active_member(p_room_id, v_uid);
  select * into r from public.rooms where id = p_room_id;
  if r.status <> 'producing' then
    raise exception using errcode = 'P0001', message = 'wrong_phase';
  end if;
  if now() >= r.phase_ends_at then
    raise exception using errcode = 'P0001', message = 'deadline_passed';
  end if;
  if (
    select count(*) from public.submission_uploads
    where room_id = r.id and round = r.round and user_id = v_uid
  ) >= 20 then
    raise exception using errcode = 'P0001', message = 'rate_limited';
  end if;

  v_path := r.id::text || '/' || r.round || '/' || gen_random_uuid()::text
    || case when v_ext = '' then '' else '.' || left(v_ext, 5) end;
  insert into public.submission_uploads (path, room_id, round, user_id) values (v_path, r.id, r.round, v_uid);
  return v_path;
end;
$$;

create or replace function public.can_upload_submission(p_object_name text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.submission_uploads u
    join public.rooms r on r.id = u.room_id
    join public.room_players rp on rp.room_id = r.id and rp.user_id = u.user_id
    where u.path = p_object_name
      and u.user_id = auth.uid()
      and r.status = 'producing'
      and r.round = u.round
      and r.phase_ends_at > now()
      and rp.left_at is null
  );
$$;

-- Others' tracks become readable once the round reaches listening, for active
-- members only; former members can read them once the round is over.
create function public.can_see_round(p_room_id uuid, p_round integer) returns boolean
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
        or (rp.left_at is null and r.status in ('listening', 'results'))
      )
  );
$$;

create or replace function public.can_read_submission(p_object_name text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.submission_uploads u
    where u.path = p_object_name and u.user_id = auth.uid()
  )
  or exists (
    select 1 from public.submissions s
    where s.storage_path = p_object_name and public.can_see_round(s.room_id, s.round)
  );
$$;

-- Same rule for table reads, except active members also wait for results:
-- during listening they get anonymized tracks from the snapshot instead.
create function public.can_see_submission_row(p_room_id uuid, p_round integer) returns boolean
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
        or (rp.left_at is null and r.status = 'results')
      )
  );
$$;

drop policy "submissions visible to room members" on public.submissions;

create policy "own submissions, others once the round is over" on public.submissions
for select to authenticated
using (user_id = (select auth.uid()) or public.can_see_submission_row(room_id, round));

-- Skips ------------------------------------------------------------------------

create table public.track_skips (
  room_id uuid not null references public.rooms (id) on delete cascade,
  round integer not null,
  submission_id uuid not null references public.submissions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (submission_id, user_id)
);

alter table public.track_skips enable row level security;
revoke all on public.track_skips from anon, authenticated;

-- Fresh active members other than the current track's producer.
create function public._eligible_voters(p_room public.rooms) returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select rp.user_id
  from public.room_players rp
  where rp.room_id = p_room.id
    and rp.left_at is null
    and rp.last_seen_at > public._fresh_cutoff()
    and rp.user_id is distinct from (select s.user_id from public._current_submission(p_room) s);
$$;

-- Skip passes with strictly more than half of the eligible voters.
create function public._skip_counts(p_room public.rooms, out votes integer, out needed integer, out eligible integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*)::integer from public.track_skips k
     where k.submission_id = (select s.id from public._current_submission(p_room) s)
       and k.user_id in (select public._eligible_voters(p_room))),
    (select count(*)::integer / 2 + 1 from public._eligible_voters(p_room)),
    (select count(*)::integer from public._eligible_voters(p_room));
$$;

create function public._skip_reached(p_room public.rooms) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select c.eligible > 0 and c.votes >= c.needed from public._skip_counts(p_room) c;
$$;

-- Early-advance checks count fresh members only -------------------------------

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
          where s.room_id = p_room.id and s.round = p_room.round and s.user_id = rp.user_id
        )
    );
$$;

create or replace function public._all_voted(p_room public.rooms) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with cur as (select * from public._current_submission(p_room))
  select exists (select 1 from cur where id is not null)
    and exists (select 1 from public._eligible_voters(p_room))
    and not exists (
      select 1 from public._eligible_voters(p_room) e(user_id), cur
      where not exists (select 1 from public.votes v where v.submission_id = cur.id and v.voter_id = e.user_id)
    );
$$;

-- A passed skip ends the track immediately. Everyone having voted only drops
-- the 5s grace: phase_ends_at is pulled in to clip end (one bump, so clients
-- re-arm their advance timer) and the track advances once the clip is over.
create or replace function public._advance_step(p_room_id uuid) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.rooms;
  v_order uuid[];
  v_clip_end timestamptz;
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
      if not public._all_voted(r) then
        return false;
      end if;
      select r.track_started_at + make_interval(secs => public._play_ms(s.duration_ms, r.listen_seconds) / 1000.0)
      into v_clip_end
      from public._current_submission(r) s;
      if now() < v_clip_end then
        if r.phase_ends_at > v_clip_end then
          update public.rooms set phase_ends_at = v_clip_end where id = r.id;
          return true;
        end if;
        return false;
      end if;
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

-- Profiles are locked in id order so two rooms finishing at once with shared
-- players can't deadlock.
create or replace function public._enter_results(p_room_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.rooms;
  v_winner_count integer;
begin
  select * into r from public.rooms where id = p_room_id;

  -- Averages are rounded to 4 places so equal fractions compare equal
  -- regardless of numeric scale; distinct averages over <= 16 voters always
  -- differ by more than that.
  insert into public.round_results (room_id, round, submission_id, user_id, avg_score, vote_count, rank, is_winner)
  select r.id, r.round, s.id, s.user_id, s.avg_score, s.vote_count,
         rank() over (order by s.avg_score desc nulls last),
         s.avg_score is not null and s.avg_score = max(s.avg_score) over ()
  from (
    select sub.id, sub.user_id, count(v.id)::integer as vote_count, round(avg(v.score)::numeric, 4) as avg_score
    from public.submissions sub
    left join public.votes v on v.submission_id = sub.id
    where sub.room_id = r.id and sub.round = r.round
    group by sub.id, sub.user_id
  ) s
  on conflict do nothing;

  select count(*) into v_winner_count
  from public.round_results where room_id = r.id and round = r.round and is_winner;

  perform 1 from public.profiles
  where id in (select user_id from public.round_results where room_id = r.id and round = r.round)
  order by id
  for update;

  update public.profiles p
  set games_played = p.games_played + 1,
      wins = p.wins + case when rr.is_winner and v_winner_count = 1 then 1 else 0 end,
      ties = p.ties + case when rr.is_winner and v_winner_count > 1 then 1 else 0 end
  from public.round_results rr
  where rr.room_id = r.id and rr.round = r.round and rr.user_id = p.id;

  update public.rooms
  set status = 'results',
      current_track = null,
      track_started_at = null,
      phase_started_at = now(),
      phase_ends_at = now() + interval '30 seconds'
  where id = p_room_id;
end;
$$;

-- Room state -----------------------------------------------------------------

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
      -- The host is implicitly ready: pressing start is their ready. Stale
      -- members don't count.
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
        'is_ready', rp.is_ready
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
          'submitted_at', s.submitted_at
        ) order by s.submitted_at)
        from public.submissions s
        where s.room_id = r.id and s.round = r.round
      ), '[]'::jsonb)
    end,
    'submitted_user_ids', coalesce((
      select jsonb_agg(s.user_id order by s.user_id)
      from public.submissions s
      where s.room_id = r.id and s.round = r.round
    ), '[]'::jsonb),
    'votes_cast', case
      when r.status = 'listening' and not r.reveal_names then '[]'::jsonb
      else coalesce((
        select jsonb_agg(jsonb_build_object('submission_id', v.submission_id, 'voter_id', v.voter_id) order by v.id)
        from public.votes v
        where v.room_id = r.id and v.round = r.round
      ), '[]'::jsonb)
    end,
    -- Aggregate only: in blind rooms a per-user list would expose the producer
    -- (the one eligible member who never votes).
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
    'results', coalesce((
      select jsonb_agg(jsonb_build_object(
        'submission_id', rr.submission_id,
        'user_id', rr.user_id,
        'avg_score', rr.avg_score,
        'vote_count', rr.vote_count,
        'rank', rr.rank,
        'is_winner', rr.is_winner
      ) order by rr.rank, rr.user_id)
      from public.round_results rr
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
        'submitted_at', s.submitted_at
      )
      from public.submissions s
      where s.room_id = p_room_id and s.round = v_round and s.user_id = v_uid
    ),
    'my_skip_votes', v_my_skips,
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
          'body', c.body, 'created_at', c.created_at
        ) as msg
        from public.chat_messages c
        join public.profiles p on p.id = c.user_id
        where c.room_id = p_room_id
        order by c.id desc
        limit 50
      ) m
    ), '[]'::jsonb)
  );
end;
$$;

-- RPCs -------------------------------------------------------------------------

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
      phase_ends_at = now() + make_interval(secs => r.produce_seconds + 15)
  where id = r.id;

  perform public._bump(r.id);
end;
$$;

create or replace function public.submit_track(p_room_id uuid, p_storage_path text, p_duration_ms integer) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  r public.rooms := public._lock_room(p_room_id);
  v_submission_id uuid;
begin
  perform public._require_active_member(r.id, v_uid);
  if r.status <> 'producing' then
    raise exception using errcode = 'P0001', message = 'wrong_phase';
  end if;
  if now() >= r.phase_ends_at then
    raise exception using errcode = 'P0001', message = 'deadline_passed';
  end if;
  if p_duration_ms is null or p_duration_ms < 1000 then
    raise exception using errcode = 'P0001', message = 'invalid_duration';
  end if;
  if not exists (
    select 1 from public.submission_uploads
    where path = p_storage_path and room_id = r.id and round = r.round and user_id = v_uid
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_path';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'submissions' and name = p_storage_path) then
    raise exception using errcode = 'P0001', message = 'upload_missing';
  end if;

  insert into public.submissions (room_id, round, user_id, storage_path, duration_ms)
  values (r.id, r.round, v_uid, p_storage_path, least(p_duration_ms, 600000))
  on conflict (room_id, round, user_id) do update
  set storage_path = excluded.storage_path, duration_ms = excluded.duration_ms, submitted_at = now()
  returning id into v_submission_id;

  perform public._advance_step(r.id);
  perform public._bump(r.id);
  return v_submission_id;
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
begin
  perform public._require_active_member(r.id, v_uid);
  if r.status <> 'listening' then
    raise exception using errcode = 'P0001', message = 'wrong_phase';
  end if;
  if now() >= r.phase_ends_at then
    raise exception using errcode = 'P0001', message = 'deadline_passed';
  end if;
  v_sub := public._current_submission(r);
  if v_sub.id is null or v_sub.id <> p_submission_id then
    raise exception using errcode = 'P0001', message = 'not_current_track';
  end if;
  if now() < r.track_started_at then
    raise exception using errcode = 'P0001', message = 'track_not_started';
  end if;
  if p_score is null or p_score not between 1 and 5 then
    raise exception using errcode = 'P0001', message = 'invalid_score';
  end if;
  if v_sub.user_id = v_uid then
    raise exception using errcode = 'P0001', message = 'self_vote';
  end if;

  begin
    insert into public.votes (room_id, round, submission_id, voter_id, score)
    values (r.id, r.round, v_sub.id, v_uid, p_score);
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'already_voted';
  end;

  perform public._advance_step(r.id);
  perform public._bump(r.id);
end;
$$;

create function public.skip_track(p_room_id uuid) returns jsonb
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
  if v_sub.user_id = v_uid then
    raise exception using errcode = 'P0001', message = 'cannot_skip_own';
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

-- Rejoining refreshes last_seen_at; otherwise identical to 20261018000007.
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

  return jsonb_build_object('room_id', r.id, 'code', r.code, 'version', public._bump(r.id));
end;
$$;

-- Ranks and filters by fresh members so ghost-filled lobbies don't win.
create or replace function public.quick_match(p_mode text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  v_candidate uuid;
begin
  if p_mode not in ('classic', 'premade', 'creative') then
    raise exception using errcode = 'P0001', message = 'invalid_mode';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('quick_match:' || p_mode, 0));
  perform public._lock_user(v_uid);

  for v_candidate in
    select r.id
    from public.rooms r
    cross join lateral (
      select count(*) as active,
             count(*) filter (where rp.last_seen_at > public._fresh_cutoff()) as fresh,
             bool_or(rp.user_id = v_uid) as mine
      from public.room_players rp
      where rp.room_id = r.id and rp.left_at is null
    ) pc
    where r.mode = p_mode and r.status = 'lobby' and not r.is_private
      and (pc.mine or (pc.fresh > 0 and pc.active < r.max_players))
    order by pc.fresh desc, r.created_at, r.id
    limit 20
  loop
    begin
      return public._join_room_locked(v_uid, v_candidate) || jsonb_build_object('created', false);
    exception when sqlstate 'P0001' then
      -- The room filled up or started between the search and the lock.
      if sqlerrm not in ('room_full', 'room_closed', 'room_in_progress') then
        raise;
      end if;
    end;
  end loop;

  return public._create_room_locked(v_uid, p_mode, 8, 1200, 20, false, null) || jsonb_build_object('created', true);
end;
$$;

-- player_count is fresh members; joinable still uses real seats. Lobbies with
-- nobody fresh are hidden; in-progress rooms always show (deadlines move them).
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
      'status', r.status,
      'max_players', r.max_players,
      'player_count', pc.fresh,
      'host_username', p.username,
      'round', r.round,
      'phase_ends_at', r.phase_ends_at,
      'estimated_end_at', public._estimated_end_at(r),
      'joinable', r.status = 'lobby' and pc.active < r.max_players,
      'created_at', r.created_at
    ) as room
    from public.rooms r
    cross join lateral (
      select count(*)::integer as active,
             (count(*) filter (where rp.last_seen_at > public._fresh_cutoff()))::integer as fresh
      from public.room_players rp
      where rp.room_id = r.id and rp.left_at is null
    ) pc
    left join public.profiles p on p.id = r.host_id
    where not r.is_private and r.status <> 'closed' and (r.status <> 'lobby' or pc.fresh > 0)
    order by r.status = 'lobby' desc, pc.fresh desc, r.created_at
    limit 100
  ) x;
$$;

drop function public.create_room(text, integer, integer, integer, boolean, text);

create function public.create_room(
  p_mode text,
  p_max_players integer default 8,
  p_produce_seconds integer default 1200,
  p_vote_seconds integer default null, -- deprecated, ignored
  p_is_private boolean default false,
  p_name text default null,
  p_reveal_names boolean default false,
  p_listen_seconds integer default 45
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  v_result jsonb;
begin
  if p_listen_seconds is null or p_listen_seconds not between 30 and 60 then
    raise exception using errcode = 'P0001', message = 'invalid_settings';
  end if;
  perform public._lock_user(v_uid);
  v_result := public._create_room_locked(
    v_uid, p_mode, p_max_players, p_produce_seconds, 20, p_is_private, p_name
  );
  update public.rooms
  set reveal_names = coalesce(p_reveal_names, false), listen_seconds = p_listen_seconds
  where id = (v_result ->> 'room_id')::uuid;
  return v_result;
end;
$$;

drop function public.update_room_settings(uuid, text, integer, integer, integer, boolean, text);

create function public.update_room_settings(
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
     or p_produce_seconds not between 60 and 7200
     or p_listen_seconds not between 30 and 60 then
    raise exception using errcode = 'P0001', message = 'invalid_settings';
  end if;
  if p_max_players < public._active_player_count(r.id) then
    raise exception using errcode = 'P0001', message = 'max_players_below_count';
  end if;

  update public.rooms
  set name = case when p_name is null then name else public._room_name(p_name, v_uid) end,
      max_players = coalesce(p_max_players, max_players),
      produce_seconds = coalesce(p_produce_seconds, produce_seconds),
      is_private = coalesce(p_is_private, is_private),
      mode = coalesce(p_mode, mode),
      reveal_names = coalesce(p_reveal_names, reveal_names),
      listen_seconds = coalesce(p_listen_seconds, listen_seconds)
  where id = r.id;

  -- Players readied up for different rules; cosmetic changes keep ready.
  if p_mode is distinct from r.mode and p_mode is not null
     or p_produce_seconds is distinct from r.produce_seconds and p_produce_seconds is not null
     or p_listen_seconds is distinct from r.listen_seconds and p_listen_seconds is not null then
    update public.room_players set is_ready = false
    where room_id = r.id and user_id <> v_uid and is_ready;
  end if;

  perform public._bump(r.id);
end;
$$;

-- Each room is advanced (or each idle lobby member removed) in its own
-- subtransaction so one failure can't roll back the rest. Everything is
-- try-locked: a room or player busy in a live RPC is simply left for the next
-- sweep.
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
    where status in ('producing', 'listening', 'results') and phase_ends_at <= now()
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

-- Renames show up in the room right away. Skip locked: if the room is busy,
-- the in-flight transaction's own broadcast picks up the committed name.
create function public.profiles_bump_active_room() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room_id uuid;
begin
  for v_room_id in
    select room_id from public.room_players where user_id = new.id and left_at is null
  loop
    perform 1 from public.rooms where id = v_room_id for update skip locked;
    if found then
      perform public._bump(v_room_id);
    end if;
  end loop;
  return null;
end;
$$;

create trigger profiles_bump_active_room
after update of username on public.profiles
for each row
when (old.username is distinct from new.username)
execute function public.profiles_bump_active_room();

revoke execute on function
  public._play_ms(integer, integer),
  public._fresh_cutoff(),
  public._eligible_voters(public.rooms),
  public._skip_counts(public.rooms),
  public._skip_reached(public.rooms),
  public.profiles_bump_active_room()
from public, anon, authenticated;

revoke execute on function
  public.touch_room(uuid),
  public.reserve_upload(uuid, text),
  public.skip_track(uuid),
  public.create_room(text, integer, integer, integer, boolean, text, boolean, integer),
  public.update_room_settings(uuid, text, integer, integer, integer, boolean, text, boolean, integer),
  public.can_see_round(uuid, integer),
  public.can_see_submission_row(uuid, integer)
from public, anon;

grant execute on function
  public.touch_room(uuid),
  public.reserve_upload(uuid, text),
  public.skip_track(uuid),
  public.create_room(text, integer, integer, integer, boolean, text, boolean, integer),
  public.update_room_settings(uuid, text, integer, integer, integer, boolean, text, boolean, integer),
  public.can_see_round(uuid, integer),
  public.can_see_submission_row(uuid, integer)
to authenticated;
