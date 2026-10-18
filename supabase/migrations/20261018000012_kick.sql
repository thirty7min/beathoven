create table public.room_bans (
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

alter table public.room_bans enable row level security;
revoke all on public.room_bans from anon, authenticated;

create table public.kick_votes (
  room_id uuid not null references public.rooms (id) on delete cascade,
  target_id uuid not null references public.profiles (id) on delete cascade,
  voter_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (room_id, target_id, voter_id)
);

alter table public.kick_votes enable row level security;
revoke all on public.kick_votes from anon, authenticated;

alter table public.chat_messages alter column user_id drop not null;
alter table public.chat_messages add column kind text not null default 'user'
  constraint chat_messages_kind check (kind in ('user', 'system'));
alter table public.chat_messages add constraint chat_messages_system_sender
  check ((kind = 'system') = (user_id is null));

create function public._system_chat(p_room_id uuid, p_body text) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.chat_messages (room_id, user_id, body, kind) values (p_room_id, null, left(p_body, 500), 'system');
$$;

create or replace function public.broadcast_chat_message() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform realtime.send(
      jsonb_build_object(
        'id', new.id,
        'room_id', new.room_id,
        'user_id', new.user_id,
        'username', (select username from public.profiles where id = new.user_id),
        'body', new.body,
        'kind', new.kind,
        'created_at', new.created_at
      ),
      'chat',
      'room:' || new.room_id::text,
      true
    );
  exception when others then
    raise warning 'chat broadcast failed for room %: %', new.room_id, sqlerrm;
  end;
  return null;
end;
$$;

create function public._is_active_in_room(p_room_id uuid, p_uid uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.room_players where room_id = p_room_id and user_id = p_uid and left_at is null);
$$;

create function public._kick_counts(
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
    where rp.room_id = p_room_id and rp.left_at is null and rp.last_seen_at > public._fresh_cutoff()
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

create function public._drop_submission_locked(p_room_id uuid, p_uid uuid) returns void
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
  if r.status not in ('producing', 'listening') then
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

  if v_index = r.current_track then
    if r.current_track < cardinality(r.track_order) - 1 then
      perform public._start_track(r.id, r.current_track);
    else
      perform public._enter_results(r.id);
    end if;
  end if;
end;
$$;

-- Caller holds the target's user lock and the room lock.
create function public._kick_locked(p_room_id uuid, p_target uuid, p_by_vote boolean) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := (select username from public.profiles where id = p_target);
begin
  perform public._drop_submission_locked(p_room_id, p_target);
  perform public._leave_room_locked(p_room_id, p_target);
  if not public._is_bot(p_target) then
    insert into public.room_bans (room_id, user_id) values (p_room_id, p_target) on conflict do nothing;
  end if;
  delete from public.kick_votes where room_id = p_room_id and (target_id = p_target or voter_id = p_target);
  perform public._system_chat(
    p_room_id,
    v_name || case when p_by_vote then ' was vote-kicked' else ' was kicked by the host' end
  );
end;
$$;

create function public.kick_player(p_room_id uuid, p_user_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  r public.rooms;
begin
  if p_user_id = v_uid then
    raise exception using errcode = 'P0001', message = 'cannot_kick_self';
  end if;
  perform public._lock_user(p_user_id);
  r := public._lock_room(p_room_id);
  perform public._require_active_member(r.id, v_uid);
  if r.host_id is distinct from v_uid then
    raise exception using errcode = 'P0001', message = 'not_host';
  end if;
  if not public._is_active_in_room(r.id, p_user_id) then
    raise exception using errcode = 'P0001', message = 'not_in_room';
  end if;
  perform public._kick_locked(r.id, p_user_id, false);
  perform public._bump(r.id);
end;
$$;

create function public.vote_kick(p_room_id uuid, p_target uuid) returns jsonb
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
      format('Vote to kick %s started (%s/%s)', (select username from public.profiles where id = p_target), c.votes, c.needed)
    );
  end if;
  perform public._bump(r.id);
  return jsonb_build_object('kicked', false, 'votes', c.votes, 'needed', c.needed);
end;
$$;

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
  if exists (select 1 from public.room_bans where room_id = p_room_id and user_id = p_uid) then
    raise exception using errcode = 'P0001', message = 'banned_from_room';
  end if;
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
  delete from public.kick_votes where room_id = r.id and target_id = p_uid;

  return jsonb_build_object('room_id', r.id, 'code', r.code, 'version', public._bump(r.id));
end;
$$;

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
      and not exists (select 1 from public.room_bans b where b.room_id = r.id and b.user_id = v_uid)
      and (pc.mine or (pc.fresh > 0 and pc.active < r.max_players))
    order by pc.fresh desc, r.created_at, r.id
    limit 20
  loop
    begin
      return public._join_room_locked(v_uid, v_candidate) || jsonb_build_object('created', false);
    exception when sqlstate 'P0001' then
      if sqlerrm not in ('room_full', 'room_closed', 'room_in_progress', 'banned_from_room') then
        raise;
      end if;
    end;
  end loop;

  return public._create_room_locked(v_uid, p_mode, 8, 1200, 20, false, null) || jsonb_build_object('created', true);
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
    -- Voter ids only with reveal_names: in blind rooms the one non-voter is the producer.
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
        'submitted_at', s.submitted_at
      )
      from public.submissions s
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
  public._system_chat(uuid, text),
  public._is_active_in_room(uuid, uuid),
  public._kick_counts(uuid, uuid),
  public._drop_submission_locked(uuid, uuid),
  public._kick_locked(uuid, uuid, boolean)
from public, anon, authenticated;

revoke execute on function public.kick_player(uuid, uuid), public.vote_kick(uuid, uuid) from public, anon;
grant execute on function public.kick_player(uuid, uuid), public.vote_kick(uuid, uuid) to authenticated;
