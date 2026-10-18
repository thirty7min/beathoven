create function public.valid_display_name(p_name text) returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_name is not null
    and p_name = btrim(p_name)
    and char_length(p_name) between 1 and 32
    and p_name !~ '[[:cntrl:]​‎‏‪-‮⁠-⁤⁦-⁩﻿]';
$$;

alter table public.profiles
  add column display_name text,
  add column onboarded_at timestamptz;

update public.profiles set display_name = username;

update public.profiles p
set onboarded_at = now()
from auth.users u
where u.id = p.id and not coalesce(u.is_anonymous, false);

alter table public.profiles
  alter column display_name set not null,
  add constraint profiles_display_name_valid check (public.valid_display_name(display_name));

create function public.profiles_default_display_name() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.display_name := coalesce(new.display_name, new.username);
  return new;
end;
$$;

create trigger profiles_default_display_name
before insert on public.profiles
for each row
execute function public.profiles_default_display_name();

grant update (display_name) on public.profiles to authenticated;

create function public.username_available(p_username text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_username, '') ~ '^[A-Za-z0-9_]{3,24}$'
    and not exists (
      select 1 from public.profiles
      where lower(username) = lower(p_username) and id is distinct from auth.uid()
    );
$$;

create function public.complete_onboarding(
  p_display_name text,
  p_username text,
  p_bio text default '',
  p_daws text[] default '{}'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  v_display_name text := btrim(regexp_replace(coalesce(p_display_name, ''), '\s+', ' ', 'g'));
  v_username text := btrim(coalesce(p_username, ''));
  v_bio text := btrim(coalesce(p_bio, ''));
  v_daws text[] := coalesce(p_daws, '{}');
begin
  if not public.valid_display_name(v_display_name) then
    raise exception using errcode = 'P0001', message = 'invalid_display_name';
  end if;
  if v_username !~ '^[A-Za-z0-9_]{3,24}$' then
    raise exception using errcode = 'P0001', message = 'invalid_username';
  end if;
  if char_length(v_bio) > 500 then
    raise exception using errcode = 'P0001', message = 'invalid_bio';
  end if;
  if not public.valid_daws(v_daws) then
    raise exception using errcode = 'P0001', message = 'invalid_daws';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('username:' || lower(v_username), 0));
  if exists (select 1 from public.profiles where lower(username) = lower(v_username) and id <> v_uid) then
    raise exception using errcode = 'P0001', message = 'username_taken';
  end if;

  begin
    update public.profiles
    set display_name = v_display_name,
        username = v_username,
        bio = v_bio,
        daws = v_daws,
        onboarded_at = coalesce(onboarded_at, now())
    where id = v_uid;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'username_taken';
  end;
  if not found then
    raise exception using errcode = 'P0001', message = 'profile_missing';
  end if;

  return jsonb_build_object(
    'id', v_uid,
    'display_name', v_display_name,
    'username', v_username,
    'bio', v_bio,
    'daws', to_jsonb(v_daws)
  );
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
        'display_name', (select display_name from public.profiles where id = new.user_id),
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

create or replace function public._kick_locked(p_room_id uuid, p_target uuid, p_by_vote boolean) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := (select display_name from public.profiles where id = p_target);
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

create or replace function public.vote_kick(p_room_id uuid, p_target uuid) returns jsonb
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
      format('Vote to kick %s started (%s/%s)', (select display_name from public.profiles where id = p_target), c.votes, c.needed)
    );
  end if;
  perform public._bump(r.id);
  return jsonb_build_object('kicked', false, 'votes', c.votes, 'needed', c.needed);
end;
$$;

create or replace function public.get_profile(p_username text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
begin
  select * into v_profile from public.profiles where lower(username) = lower(btrim(p_username));
  if v_profile.id is null then
    raise exception using errcode = 'P0001', message = 'profile_not_found';
  end if;

  return jsonb_build_object(
    'profile', jsonb_build_object(
      'id', v_profile.id,
      'username', v_profile.username,
      'display_name', v_profile.display_name,
      'avatar_url', v_profile.avatar_url,
      'bio', v_profile.bio,
      'daws', to_jsonb(v_profile.daws),
      'link_url', v_profile.link_url,
      'wins', v_profile.wins,
      'ties', v_profile.ties,
      'games_played', v_profile.games_played,
      'created_at', v_profile.created_at
    ),
    'recent_results', coalesce((
      select jsonb_agg(x.result order by x.finished_at desc)
      from (
        select rr.finished_at, jsonb_build_object(
          'room_name', case when r.is_private then null else r.name end,
          'mode', r.mode,
          'round', rr.round,
          'avg_score', rr.avg_score,
          'vote_count', rr.vote_count,
          'rank', rr.rank,
          'entrants', (
            select count(*) from public.round_results o where o.room_id = rr.room_id and o.round = rr.round
          ),
          'is_winner', rr.is_winner,
          'finished_at', rr.finished_at
        ) as result
        from public.round_results rr
        join public.rooms r on r.id = rr.room_id
        where rr.user_id = v_profile.id
        order by rr.finished_at desc
        limit 20
      ) x
    ), '[]'::jsonb)
  );
end;
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

create or replace function public.dev_register_bot(p_user_id uuid, p_storage_path text, p_duration_ms integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number integer;
  v_username text;
begin
  perform public._require_dev_tools();
  if p_storage_path !~ '^bots/[A-Za-z0-9_-]+\.wav$' then
    raise exception using errcode = 'P0001', message = 'invalid_path';
  end if;
  if p_duration_ms is null or p_duration_ms not between 1000 and 600000 then
    raise exception using errcode = 'P0001', message = 'invalid_duration';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('dev_register_bot', 0));

  v_number := coalesce((select max(number) from public.dev_bots), 0) + 1;
  while exists (select 1 from public.profiles where lower(username) = lower('Bot_' || v_number)) loop
    v_number := v_number + 1;
  end loop;
  v_username := 'Bot_' || v_number;

  update public.profiles
  set is_bot = true, username = v_username, display_name = v_username, onboarded_at = coalesce(onboarded_at, now())
  where id = p_user_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'profile_not_found';
  end if;
  insert into public.dev_bots (user_id, number, storage_path, duration_ms)
  values (p_user_id, v_number, p_storage_path, p_duration_ms);

  return jsonb_build_object('user_id', p_user_id, 'username', v_username);
end;
$$;

revoke execute on function public.profiles_default_display_name() from public, anon, authenticated;

revoke execute on function
  public.username_available(text),
  public.complete_onboarding(text, text, text, text[])
from public, anon;

grant execute on function
  public.username_available(text),
  public.complete_onboarding(text, text, text, text[])
to authenticated;
