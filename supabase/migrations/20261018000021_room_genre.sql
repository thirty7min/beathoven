create function public.room_genres() returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'all', 'hip-hop', 'trap', 'drill', 'rnb', 'pop', 'edm', 'house',
    'dnb', 'lofi', 'afro', 'latin', 'rock', 'cinematic', 'other'
  ];
$$;

create function public._valid_genre(p_genre text) returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_genre = any(public.room_genres());
$$;

alter table public.rooms
  add column genre text not null default 'all' constraint rooms_genre_valid check (public._valid_genre(genre));

drop function public.create_room(text, integer, integer, integer, boolean, text, boolean, integer);
drop function public.update_room_settings(uuid, text, integer, integer, integer, boolean, text, boolean, integer);
drop function public.quick_match(text);

create function public.create_room(
  p_mode text,
  p_max_players integer default 8,
  p_produce_seconds integer default 1200,
  p_vote_seconds integer default null,
  p_is_private boolean default false,
  p_name text default null,
  p_reveal_names boolean default false,
  p_listen_seconds integer default 45,
  p_genre text default 'all'
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
  if p_genre is null or not public._valid_genre(p_genre) then
    raise exception using errcode = 'P0001', message = 'invalid_genre';
  end if;
  perform public._lock_user(v_uid);
  v_result := public._create_room_locked(
    v_uid, p_mode, p_max_players, p_produce_seconds, 20, p_is_private, p_name
  );
  update public.rooms
  set reveal_names = coalesce(p_reveal_names, false), listen_seconds = p_listen_seconds, genre = p_genre
  where id = (v_result ->> 'room_id')::uuid;
  return v_result;
end;
$$;

create function public.update_room_settings(
  p_room_id uuid,
  p_name text default null,
  p_max_players integer default null,
  p_produce_seconds integer default null,
  p_vote_seconds integer default null,
  p_is_private boolean default null,
  p_mode text default null,
  p_reveal_names boolean default null,
  p_listen_seconds integer default null,
  p_genre text default null
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
  if p_genre is not null and not public._valid_genre(p_genre) then
    raise exception using errcode = 'P0001', message = 'invalid_genre';
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
      listen_seconds = coalesce(p_listen_seconds, listen_seconds),
      genre = coalesce(p_genre, genre)
  where id = r.id;

  if p_mode is distinct from r.mode and p_mode is not null
     or v_mode <> 'premade' and p_produce_seconds is distinct from r.produce_seconds and p_produce_seconds is not null
     or p_listen_seconds is distinct from r.listen_seconds and p_listen_seconds is not null then
    update public.room_players set is_ready = false
    where room_id = r.id and user_id <> v_uid and is_ready;
  end if;
  perform public._sync_autostart(r.id, true);

  perform public._bump(r.id);
end;
$$;

create function public.quick_match(p_mode text, p_genre text default 'all') returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  v_candidate uuid;
  v_result jsonb;
begin
  if p_mode not in ('classic', 'premade', 'creative') then
    raise exception using errcode = 'P0001', message = 'invalid_mode';
  end if;
  if p_genre is null or not public._valid_genre(p_genre) then
    raise exception using errcode = 'P0001', message = 'invalid_genre';
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
      and (p_genre = 'all' or r.genre in (p_genre, 'all'))
      and not exists (select 1 from public.room_bans b where b.room_id = r.id and b.user_id = v_uid)
      and (pc.mine or (pc.fresh > 0 and pc.active < r.max_players))
    order by r.genre = p_genre desc, pc.fresh desc, r.created_at, r.id
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

  v_result := public._create_room_locked(v_uid, p_mode, 8, 1200, 20, false, null);
  update public.rooms set genre = p_genre where id = (v_result ->> 'room_id')::uuid;
  return v_result || jsonb_build_object('created', true);
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
      'genre', r.genre,
      'status', r.status,
      'max_players', r.max_players,
      'player_count', pc.fresh,
      'host_username', p.username,
      'host_display_name', p.display_name,
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

revoke execute on function public._valid_genre(text) from public, anon, authenticated;

revoke execute on function
  public.create_room(text, integer, integer, integer, boolean, text, boolean, integer, text),
  public.update_room_settings(uuid, text, integer, integer, integer, boolean, text, boolean, integer, text),
  public.quick_match(text, text)
from public, anon;

grant execute on function
  public.create_room(text, integer, integer, integer, boolean, text, boolean, integer, text),
  public.update_room_settings(uuid, text, integer, integer, integer, boolean, text, boolean, integer, text),
  public.quick_match(text, text)
to authenticated;
