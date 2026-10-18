create table public.tracks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null constraint tracks_title_length check (char_length(title) between 1 and 80),
  title_edited boolean not null default false,
  latest_submission_id uuid references public.submissions (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tracks_user_idx on public.tracks (user_id, created_at desc);

alter table public.submissions
  add column track_id uuid references public.tracks (id) on delete set null,
  add column match_source text constraint submissions_match_source check (match_source in ('exact', 'fingerprint', 'manual')),
  add column match_score real constraint submissions_match_score check (match_score between 0 and 1);

create index submissions_track_idx on public.submissions (track_id);
create index submissions_user_submitted_idx on public.submissions (user_id, submitted_at desc);

create table public.submission_fingerprints (
  submission_id uuid primary key references public.submissions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  storage_path text not null,
  payload_sha256 text constraint submission_fingerprints_sha check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  title_hint text constraint submission_fingerprints_title_hint check (char_length(title_hint) between 1 and 80),
  fingerprint bytea,
  fingerprint_status text not null default 'pending'
    constraint submission_fingerprints_status check (fingerprint_status in ('pending', 'done', 'failed')),
  attempts integer not null default 0,
  updated_at timestamptz not null default now()
);

create index submission_fingerprints_user_sha_idx on public.submission_fingerprints (user_id, payload_sha256);
create index submission_fingerprints_retry_idx on public.submission_fingerprints (fingerprint_status, updated_at)
  where fingerprint_status <> 'done';

create table public.track_no_match (
  track_a uuid not null references public.tracks (id) on delete cascade,
  track_b uuid not null references public.tracks (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (track_a, track_b),
  constraint track_no_match_ordered check (track_a < track_b)
);

create index track_no_match_b_idx on public.track_no_match (track_b);

create table public.track_suggestions (
  submission_id uuid primary key references public.submissions (id) on delete cascade,
  track_id uuid not null references public.tracks (id) on delete cascade,
  score real not null constraint track_suggestions_score check (score between 0 and 1),
  created_at timestamptz not null default now()
);

create index track_suggestions_track_idx on public.track_suggestions (track_id);

alter table public.tracks enable row level security;
alter table public.submission_fingerprints enable row level security;
alter table public.track_no_match enable row level security;
alter table public.track_suggestions enable row level security;
revoke all on public.tracks, public.submission_fingerprints, public.track_no_match, public.track_suggestions
from anon, authenticated;

create function public._tracks_split(p_a uuid, p_b uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.track_no_match
    where track_a = least(p_a, p_b) and track_b = greatest(p_a, p_b)
  );
$$;

create function public._mark_tracks_split(p_a uuid, p_b uuid) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.track_no_match (track_a, track_b)
  values (least(p_a, p_b), greatest(p_a, p_b))
  on conflict do nothing;
$$;

create function public._refresh_track(p_track_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_track_id is null then
    return;
  end if;
  update public.tracks t
  set latest_submission_id = (
        select s.id from public.submissions s
        where s.track_id = t.id
        order by s.submitted_at desc, s.id desc
        limit 1
      ),
      updated_at = now()
  where t.id = p_track_id;
  delete from public.tracks where id = p_track_id and latest_submission_id is null;
end;
$$;

create function public._clean_track_title(p_title text) returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(coalesce(p_title, ''), '[[:space:][:cntrl:]]+', ' ', 'g')), '');
$$;

create function public.submissions_track_upkeep() returns trigger
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

create trigger submissions_reset_track
before update of storage_path on public.submissions
for each row
execute function public.submissions_track_upkeep();

create trigger submissions_track_upkeep
after update or delete on public.submissions
for each row
execute function public.submissions_track_upkeep();

create function public.register_submission_audio(
  p_submission_id uuid,
  p_storage_path text,
  p_payload_sha256 text,
  p_title_hint text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := left(public._clean_track_title(p_title_hint), 80);
begin
  insert into public.submission_fingerprints (submission_id, user_id, storage_path, payload_sha256, title_hint)
  select s.id, s.user_id, s.storage_path, p_payload_sha256, v_title
  from public.submissions s
  where s.id = p_submission_id and s.storage_path = p_storage_path
  on conflict (submission_id) do update
  set payload_sha256 = coalesce(excluded.payload_sha256, public.submission_fingerprints.payload_sha256),
      title_hint = coalesce(excluded.title_hint, public.submission_fingerprints.title_hint);
  return found;
end;
$$;

create function public.track_match_context(p_submission_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', s.user_id,
    'track_id', s.track_id,
    'storage_path', s.storage_path,
    'duration_ms', s.duration_ms,
    'candidates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'track_id', c.track_id,
        'duration_ms', c.duration_ms,
        'fingerprint', c.fingerprint
      ))
      from (
        select o.track_id, o.duration_ms, f.fingerprint
        from public.submissions o
        join public.submission_fingerprints f on f.submission_id = o.id and f.storage_path = o.storage_path
        where o.user_id = s.user_id
          and o.id <> s.id
          and o.track_id is not null
          and o.track_id is distinct from s.track_id
          and f.fingerprint_status = 'done'
          and f.fingerprint is not null
          and abs(o.duration_ms - s.duration_ms) <= greatest(20000, 0.15 * greatest(o.duration_ms, s.duration_ms))
          and (s.track_id is null or not public._tracks_split(o.track_id, s.track_id))
        order by o.submitted_at desc
        limit 500
      ) c
    ), '[]'::jsonb)
  )
  from public.submissions s
  where s.id = p_submission_id;
$$;

create function public.assign_submission_track(
  p_submission_id uuid,
  p_storage_path text,
  p_fingerprint bytea,
  p_status text,
  p_track_id uuid default null,
  p_score real default null,
  p_suggest_track_id uuid default null,
  p_suggest_score real default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.submissions;
  f public.submission_fingerprints;
  v_reassignable boolean;
  v_target uuid;
  v_source text;
  v_score real;
begin
  if p_status not in ('done', 'failed') then
    raise exception using errcode = 'P0001', message = 'invalid_fingerprint_status';
  end if;

  select * into s from public.submissions where id = p_submission_id;
  if s.id is null then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tracks:' || s.user_id::text, 0));
  select * into s from public.submissions where id = p_submission_id for update;
  select * into f from public.submission_fingerprints where submission_id = p_submission_id for update;
  if s.id is null or f.submission_id is null or s.storage_path <> p_storage_path or f.storage_path <> p_storage_path then
    return null;
  end if;

  update public.submission_fingerprints
  set fingerprint = case when p_status = 'done' then p_fingerprint else fingerprint end,
      fingerprint_status = case when fingerprint_status = 'done' and p_status = 'failed' then 'done' else p_status end,
      attempts = attempts + 1,
      updated_at = now()
  where submission_id = s.id;

  v_reassignable := s.track_id is null or (
    s.match_source is null
    and not exists (select 1 from public.submissions o where o.track_id = s.track_id and o.id <> s.id)
    and not exists (select 1 from public.tracks t where t.id = s.track_id and t.title_edited)
    and not exists (select 1 from public.track_no_match n where s.track_id in (n.track_a, n.track_b))
  );
  if not v_reassignable then
    return jsonb_build_object('track_id', s.track_id, 'match_source', s.match_source);
  end if;

  select o.track_id into v_target
  from public.submissions o
  join public.submission_fingerprints fo on fo.submission_id = o.id and fo.storage_path = o.storage_path
  where o.user_id = s.user_id
    and o.id <> s.id
    and o.track_id is not null
    and o.track_id is distinct from s.track_id
    and fo.payload_sha256 = f.payload_sha256
  order by o.submitted_at desc
  limit 1;

  if v_target is not null then
    v_source := 'exact';
    v_score := 0;
  elsif p_track_id is not null and p_track_id is distinct from s.track_id
    and exists (select 1 from public.tracks t where t.id = p_track_id and t.user_id = s.user_id) then
    v_target := p_track_id;
    v_source := 'fingerprint';
    v_score := p_score;
  end if;

  if v_target is not null then
    update public.submissions set track_id = v_target, match_source = v_source, match_score = v_score where id = s.id;
    delete from public.track_suggestions where submission_id = s.id;
    return jsonb_build_object('track_id', v_target, 'match_source', v_source);
  end if;

  v_target := s.track_id;
  if v_target is null then
    insert into public.tracks (user_id, title)
    values (s.user_id, coalesce(f.title_hint, 'Untitled track'))
    returning id into v_target;
    update public.submissions set track_id = v_target where id = s.id;
  end if;

  if p_suggest_track_id is not null and p_suggest_track_id <> v_target
    and exists (select 1 from public.tracks t where t.id = p_suggest_track_id and t.user_id = s.user_id)
    and not public._tracks_split(v_target, p_suggest_track_id) then
    insert into public.track_suggestions (submission_id, track_id, score)
    values (s.id, p_suggest_track_id, p_suggest_score)
    on conflict (submission_id) do update set track_id = excluded.track_id, score = excluded.score, created_at = now();
  end if;
  return jsonb_build_object('track_id', v_target, 'match_source', null);
end;
$$;

create function public.fingerprint_retry_candidates(p_limit integer default 10)
returns table (submission_id uuid, storage_path text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.storage_path
  from public.submissions s
  join public.profiles p on p.id = s.user_id
  left join public.submission_fingerprints f on f.submission_id = s.id
  where s.purged_at is null
    and not p.is_bot
    and (
      (f.submission_id is null and s.submitted_at < now() - interval '10 minutes')
      or (f.fingerprint_status = 'pending' and f.updated_at < now() - interval '10 minutes')
      or (f.fingerprint_status = 'failed' and f.attempts < 5 and f.updated_at < now() - interval '1 hour')
    )
  order by s.submitted_at desc
  limit least(greatest(p_limit, 1), 50);
$$;

create function public._owned_track(p_uid uuid, p_track_id uuid) returns public.tracks
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tracks;
begin
  select * into t from public.tracks where id = p_track_id and user_id = p_uid for update;
  if t.id is null then
    raise exception using errcode = 'P0001', message = 'track_not_found';
  end if;
  return t;
end;
$$;

create function public._owned_track_submission(p_uid uuid, p_submission_id uuid) returns public.submissions
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.submissions;
begin
  select * into s from public.submissions where id = p_submission_id and user_id = p_uid for update;
  if s.id is null or s.track_id is null then
    raise exception using errcode = 'P0001', message = 'track_not_found';
  end if;
  return s;
end;
$$;

create function public.rename_track(p_track_id uuid, p_title text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  v_title text := public._clean_track_title(p_title);
begin
  if v_title is null or char_length(v_title) > 80 then
    raise exception using errcode = 'P0001', message = 'invalid_track_title';
  end if;
  perform public._owned_track(v_uid, p_track_id);
  update public.tracks set title = v_title, title_edited = true, updated_at = now() where id = p_track_id;
end;
$$;

create function public.merge_tracks(p_target uuid, p_source uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
begin
  if p_target = p_source then
    raise exception using errcode = 'P0001', message = 'cannot_merge_same_track';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tracks:' || v_uid::text, 0));
  perform public._owned_track(v_uid, least(p_target, p_source));
  perform public._owned_track(v_uid, greatest(p_target, p_source));

  delete from public.track_no_match
  where track_a = least(p_target, p_source) and track_b = greatest(p_target, p_source);
  insert into public.track_no_match (track_a, track_b)
  select least(p_target, other), greatest(p_target, other)
  from (
    select case when track_a = p_source then track_b else track_a end as other
    from public.track_no_match
    where p_source in (track_a, track_b)
  ) n
  on conflict do nothing;

  update public.track_suggestions set track_id = p_target where track_id = p_source;
  delete from public.track_suggestions sg
  using public.submissions s
  where sg.submission_id = s.id and s.track_id in (p_target, p_source) and sg.track_id = p_target;

  update public.submissions
  set track_id = p_target, match_source = 'manual', match_score = null
  where track_id = p_source;
  delete from public.tracks where id = p_source;
end;
$$;

create function public.split_submission(p_submission_id uuid) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  s public.submissions;
  v_old public.tracks;
  v_new uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('tracks:' || v_uid::text, 0));
  s := public._owned_track_submission(v_uid, p_submission_id);
  v_old := public._owned_track(v_uid, s.track_id);
  if not exists (select 1 from public.submissions where track_id = s.track_id and id <> s.id) then
    raise exception using errcode = 'P0001', message = 'cannot_split_only_submission';
  end if;

  insert into public.tracks (user_id, title)
  values (
    v_uid,
    coalesce((select title_hint from public.submission_fingerprints where submission_id = s.id), v_old.title)
  )
  returning id into v_new;
  update public.submissions set track_id = v_new, match_source = 'manual', match_score = null where id = s.id;
  delete from public.track_suggestions where submission_id = s.id;
  perform public._mark_tracks_split(v_old.id, v_new);
  return v_new;
end;
$$;

create function public.confirm_track_suggestion(p_submission_id uuid) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  s public.submissions;
  sg public.track_suggestions;
begin
  perform pg_advisory_xact_lock(hashtextextended('tracks:' || v_uid::text, 0));
  s := public._owned_track_submission(v_uid, p_submission_id);
  select * into sg from public.track_suggestions where submission_id = s.id;
  if sg.submission_id is null then
    raise exception using errcode = 'P0001', message = 'suggestion_not_found';
  end if;
  update public.submissions set track_id = sg.track_id, match_source = 'manual', match_score = sg.score where id = s.id;
  delete from public.track_suggestions where submission_id = s.id;
  return sg.track_id;
end;
$$;

create function public.dismiss_track_suggestion(p_submission_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  s public.submissions;
  sg public.track_suggestions;
begin
  perform pg_advisory_xact_lock(hashtextextended('tracks:' || v_uid::text, 0));
  s := public._owned_track_submission(v_uid, p_submission_id);
  select * into sg from public.track_suggestions where submission_id = s.id;
  if sg.submission_id is null then
    raise exception using errcode = 'P0001', message = 'suggestion_not_found';
  end if;
  perform public._mark_tracks_split(s.track_id, sg.track_id);
  delete from public.track_suggestions where submission_id = s.id;
end;
$$;

create function public.get_my_tracks() returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x.track order by x.latest_at desc nulls last), '[]'::jsonb)
  from (
    select t.id, max(s.submitted_at) as latest_at, jsonb_build_object(
      'id', t.id,
      'title', t.title,
      'title_edited', t.title_edited,
      'created_at', t.created_at,
      'latest_submission_id', t.latest_submission_id,
      'submissions', jsonb_agg(jsonb_build_object(
        'id', s.id,
        'submitted_at', s.submitted_at,
        'duration_ms', s.duration_ms,
        'mode', r.mode,
        'finished', exists (select 1 from public.round_results rr where rr.submission_id = s.id),
        'match_source', s.match_source,
        'match_score', s.match_score
      ) order by s.submitted_at desc),
      'suggestions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'submission_id', sg.submission_id,
          'track_id', sg.track_id,
          'track_title', st.title,
          'score', sg.score
        ) order by sg.created_at desc)
        from public.track_suggestions sg
        join public.submissions ss on ss.id = sg.submission_id
        join public.tracks st on st.id = sg.track_id
        where ss.track_id = t.id
      ), '[]'::jsonb)
    ) as track
    from public.tracks t
    join public.submissions s on s.track_id = t.id
    join public.rooms r on r.id = s.room_id
    where t.user_id = public._require_uid()
    group by t.id
  ) x;
$$;

create function public.get_profile_tracks(p_username text, p_sort text default 'wins', p_limit integer default 50)
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
      'last_played_at', st.last_played_at
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
  ), '[]'::jsonb);
end;
$$;

revoke execute on function
  public._tracks_split(uuid, uuid),
  public._mark_tracks_split(uuid, uuid),
  public._refresh_track(uuid),
  public._clean_track_title(text),
  public.submissions_track_upkeep(),
  public._owned_track(uuid, uuid),
  public._owned_track_submission(uuid, uuid),
  public.register_submission_audio(uuid, text, text, text),
  public.track_match_context(uuid),
  public.assign_submission_track(uuid, text, bytea, text, uuid, real, uuid, real),
  public.fingerprint_retry_candidates(integer),
  public.rename_track(uuid, text),
  public.merge_tracks(uuid, uuid),
  public.split_submission(uuid),
  public.confirm_track_suggestion(uuid),
  public.dismiss_track_suggestion(uuid),
  public.get_my_tracks(),
  public.get_profile_tracks(text, text, integer)
from public, anon, authenticated;

grant execute on function
  public.register_submission_audio(uuid, text, text, text),
  public.track_match_context(uuid),
  public.assign_submission_track(uuid, text, bytea, text, uuid, real, uuid, real),
  public.fingerprint_retry_candidates(integer)
to service_role;

grant execute on function
  public.rename_track(uuid, text),
  public.merge_tracks(uuid, uuid),
  public.split_submission(uuid),
  public.confirm_track_suggestion(uuid),
  public.dismiss_track_suggestion(uuid),
  public.get_my_tracks()
to authenticated;

grant execute on function public.get_profile_tracks(text, text, integer) to anon, authenticated;
