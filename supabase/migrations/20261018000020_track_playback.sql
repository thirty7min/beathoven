create function public._valid_peaks(p_peaks smallint[]) returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_peaks is null or (
    coalesce(array_ndims(p_peaks), 0) = 1
    and cardinality(p_peaks) = 120
    and not exists (select 1 from unnest(p_peaks) as v where v is null or v not between 0 and 255)
  );
$$;

alter table public.submissions add column peaks smallint[] constraint submissions_peaks_valid check (public._valid_peaks(peaks));

create index tracks_latest_submission_idx on public.tracks (latest_submission_id);

create table public.submission_object_purges (
  storage_path text primary key,
  queued_at timestamptz not null default now()
);

create table public.track_stream_requests (
  requester text not null,
  created_at timestamptz not null default now()
);

create index track_stream_requests_requester_idx on public.track_stream_requests (requester, created_at);
create index track_stream_requests_created_idx on public.track_stream_requests (created_at);

alter table public.submission_object_purges enable row level security;
alter table public.track_stream_requests enable row level security;
revoke all on public.submission_object_purges, public.track_stream_requests from anon, authenticated;

create function public.queue_submission_object_purge() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.purged_at is null and old.storage_path not like 'bots/%' then
    insert into public.submission_object_purges (storage_path) values (old.storage_path) on conflict do nothing;
  end if;
  return null;
end;
$$;

create trigger submissions_queue_object_purge
after delete on public.submissions
for each row
execute function public.queue_submission_object_purge();

create function public.queued_submission_object_purges(p_limit integer default 500) returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select storage_path from public.submission_object_purges order by queued_at limit p_limit;
$$;

create function public.clear_submission_object_purges(p_paths text[]) returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.submission_object_purges where storage_path = any(p_paths);
$$;

create function public._track_public_submission(p_track_id uuid) returns public.submissions
language sql
stable
security definer
set search_path = ''
as $$
  select s.*
  from public.tracks t
  join public.submissions s on s.id = t.latest_submission_id
  where t.id = p_track_id
    and s.purged_at is null
    and exists (select 1 from public.round_results rr where rr.submission_id = s.id);
$$;

create function public.get_track_stream(p_track_id uuid, p_requester text) returns jsonb
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
    'clip_end_ms', s.clip_end_ms
  );
end;
$$;

drop function public.confirm_submission(uuid, integer, integer);
drop function public.set_submission_clip(uuid, integer, integer);
drop function public._save_clip(uuid, integer, integer, boolean);

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

create or replace function public.submissions_due_for_purge(p_limit integer default 500)
returns table (submission_id uuid, storage_path text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.storage_path
  from public.submissions s
  join public.rooms r on r.id = s.room_id
  where r.status = 'closed' and r.updated_at < now() - interval '30 days' and s.purged_at is null
    and s.storage_path not like 'bots/%'
    and not exists (select 1 from public.tracks t where t.latest_submission_id = s.id)
  order by r.updated_at
  limit p_limit;
$$;

create function public._save_clip(p_room_id uuid, p_clip_start_ms integer, p_clip_end_ms integer, p_confirm boolean, p_peaks smallint[])
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
      peaks = coalesce(p_peaks, peaks)
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

create function public.confirm_submission(p_room_id uuid, p_clip_start_ms integer, p_clip_end_ms integer, p_peaks smallint[] default null) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public._save_clip(p_room_id, p_clip_start_ms, p_clip_end_ms, true, p_peaks);
$$;

create function public.set_submission_clip(p_room_id uuid, p_clip_start_ms integer, p_clip_end_ms integer, p_peaks smallint[] default null) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public._save_clip(p_room_id, p_clip_start_ms, p_clip_end_ms, false, p_peaks);
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

revoke execute on function
  public.queue_submission_object_purge(),
  public.queued_submission_object_purges(integer),
  public.clear_submission_object_purges(text[]),
  public._track_public_submission(uuid),
  public.get_track_stream(uuid, text),
  public._save_clip(uuid, integer, integer, boolean, smallint[])
from public, anon, authenticated;

grant execute on function
  public.queued_submission_object_purges(integer),
  public.clear_submission_object_purges(text[]),
  public.get_track_stream(uuid, text)
to service_role;

revoke execute on function
  public.confirm_submission(uuid, integer, integer, smallint[]),
  public.set_submission_clip(uuid, integer, integer, smallint[])
from public, anon;

grant execute on function
  public.confirm_submission(uuid, integer, integer, smallint[]),
  public.set_submission_clip(uuid, integer, integer, smallint[])
to authenticated;
