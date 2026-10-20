create sequence public.room_players_sort_key_seq;

alter table public.room_players add column sort_key bigint;

update public.room_players rp
set sort_key = o.n
from (
  select x.room_id, x.user_id, row_number() over (order by x.user_id = r.host_id desc, x.joined_at, x.user_id) as n
  from public.room_players x
  join public.rooms r on r.id = x.room_id
) o
where o.room_id = rp.room_id and o.user_id = rp.user_id;

select setval('public.room_players_sort_key_seq', coalesce((select max(sort_key) from public.room_players), 0) + 1, false);

alter table public.room_players
  alter column sort_key set default nextval('public.room_players_sort_key_seq'),
  alter column sort_key set not null;

alter sequence public.room_players_sort_key_seq owned by public.room_players.sort_key;

create function public._make_host_locked(p_room_id uuid, p_user_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.room_players
  set sort_key = (select min(sort_key) - 1 from public.room_players where room_id = p_room_id)
  where room_id = p_room_id
    and user_id = (select host_id from public.rooms where id = p_room_id)
    and user_id <> p_user_id
    and left_at is null;
  update public.room_players
  set sort_key = (select min(sort_key) - 1 from public.room_players where room_id = p_room_id)
  where room_id = p_room_id and user_id = p_user_id;
  update public.rooms set host_id = p_user_id where id = p_room_id;
end;
$$;

create or replace function public._leave_room_locked(p_room_id uuid, p_uid uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.rooms;
  v_role text;
  v_next_host uuid;
begin
  select * into r from public.rooms where id = p_room_id;

  update public.room_players set left_at = now(), is_ready = false
  where room_id = r.id and user_id = p_uid
  returning role into v_role;

  perform public._promote_spectators(r.id);

  if not exists (
    select 1 from public.room_players rp
    join public.profiles p on p.id = rp.user_id
    where rp.room_id = r.id and rp.left_at is null and rp.role = 'player' and not p.is_bot
  ) then
    update public.room_players set left_at = now(), is_ready = false
    where room_id = r.id and left_at is null;
  end if;

  if r.host_id is not distinct from p_uid then
    select rp.user_id into v_next_host
    from public.room_players rp
    join public.profiles p on p.id = rp.user_id
    where rp.room_id = r.id and rp.left_at is null and rp.role = 'player'
    order by p.is_bot, rp.sort_key, rp.user_id
    limit 1;
    if v_next_host is not null then
      perform public._make_host_locked(r.id, v_next_host);
    end if;
  end if;

  perform public._sync_autostart(r.id, v_role is distinct from 'spectator');

  if public._active_player_count(r.id) = 0 then
    update public.rooms
    set status = 'closed', phase_ends_at = null, current_track = null, track_started_at = null, autostart_at = null
    where id = r.id;
  else
    perform public._advance_step(r.id);
  end if;
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

  insert into public.room_players (room_id, user_id, role)
  values (r.id, p_uid, v_role)
  on conflict (room_id, user_id) do update
  set left_at = null, joined_at = now(), last_seen_at = now(), is_ready = false, role = excluded.role, sort_key = excluded.sort_key;
  delete from public.kick_votes where room_id = r.id and target_id = p_uid;
  if v_role = 'player' then
    perform public._sync_autostart(r.id, true);
  end if;

  return jsonb_build_object('room_id', r.id, 'code', r.code, 'version', public._bump(r.id), 'role', v_role);
end;
$$;

create function public._room_players_json(p_room_id uuid) returns jsonb
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
      where rp.room_id = r.id and rp.left_at is null and rp.role = 'player' and rp.last_seen_at > public._fresh_cutoff()
    ),
    'players', public._room_players_json(r.id),
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

create function public.transfer_host(p_room_id uuid, p_user_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  r public.rooms := public._lock_room(p_room_id);
  v_role text;
  v_is_bot boolean;
begin
  perform public._require_active_member(r.id, v_uid);
  if r.host_id is distinct from v_uid then
    raise exception using errcode = 'P0001', message = 'not_host';
  end if;
  if r.status <> 'lobby' then
    raise exception using errcode = 'P0001', message = 'wrong_phase';
  end if;
  if p_user_id = v_uid then
    raise exception using errcode = 'P0001', message = 'already_host';
  end if;

  select rp.role, p.is_bot into v_role, v_is_bot
  from public.room_players rp
  join public.profiles p on p.id = rp.user_id
  where rp.room_id = r.id and rp.user_id = p_user_id and rp.left_at is null;
  if v_role is null then
    raise exception using errcode = 'P0001', message = 'not_in_room';
  end if;
  if v_role <> 'player' then
    raise exception using errcode = 'P0001', message = 'host_must_be_player';
  end if;
  if v_is_bot then
    raise exception using errcode = 'P0001', message = 'bot_cannot_host';
  end if;

  perform public._make_host_locked(r.id, p_user_id);
  perform public._system_chat(r.id, (select display_name from public.profiles where id = p_user_id) || ' is now the host');
  perform public._bump(r.id);
end;
$$;

revoke execute on function
  public._make_host_locked(uuid, uuid),
  public._room_players_json(uuid)
from public, anon, authenticated;

revoke execute on function public.transfer_host(uuid, uuid) from public, anon;
grant execute on function public.transfer_host(uuid, uuid) to authenticated;
