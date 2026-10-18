create table public.uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null constraint uploads_kind check (kind in ('submission', 'avatar')),
  room_id uuid references public.rooms (id) on delete cascade,
  round integer,
  status text not null default 'pending' constraint uploads_status check (status in ('pending', 'verified', 'rejected')),
  quarantine_path text unique,
  final_path text,
  mime text,
  size bigint,
  sha256 text,
  duration_ms integer,
  reject_reason text,
  created_at timestamptz not null default now(),
  constraint uploads_submission_target check ((kind = 'submission') = (room_id is not null and round is not null))
);

create index uploads_user_kind_created_idx on public.uploads (user_id, kind, created_at desc);

alter table public.uploads enable row level security;
revoke all on public.uploads from anon, authenticated;
grant select on public.uploads to authenticated;

create policy "uploads: read own" on public.uploads
for select to authenticated
using (user_id = (select auth.uid()));

create table public.blocked_hashes (
  sha256 text primary key,
  reason text not null default '',
  created_at timestamptz not null default now()
);

alter table public.blocked_hashes enable row level security;
revoke all on public.blocked_hashes from anon, authenticated;

alter table public.submissions add column purged_at timestamptz;
alter table public.submissions drop constraint submissions_duration_ms_check;
alter table public.submissions add constraint submissions_duration_ms_check check (duration_ms between 1000 and 900000);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'quarantine', 'quarantine', false, 52428800,
    array['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave',
          'audio/flac', 'audio/x-flac', 'audio/aac', 'audio/mp4', 'audio/x-m4a', 'audio/ogg']
  ),
  ('avatars', 'avatars', true, 262144, array['image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

update storage.buckets
set allowed_mime_types = array['audio/mpeg', 'audio/wav', 'audio/flac', 'audio/ogg', 'audio/mp4', 'audio/aac']
where id = 'submissions';

drop policy "submissions: upload own" on storage.objects;
drop policy "submissions: replace own" on storage.objects;
drop function public.can_upload_submission(text);

create function public.can_upload_quarantine(p_object_name text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.uploads u
    where u.quarantine_path = p_object_name
      and u.user_id = auth.uid()
      and u.status = 'pending'
      and u.created_at > now() - interval '1 hour'
  );
$$;

create policy "quarantine: upload reserved" on storage.objects
for insert to authenticated
with check (bucket_id = 'quarantine' and public.can_upload_quarantine(name));

create policy "avatars: read" on storage.objects
for select to anon, authenticated
using (bucket_id = 'avatars');

create or replace function public.can_read_submission(p_object_name text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.uploads u
    where u.final_path = p_object_name and u.kind = 'submission' and u.user_id = auth.uid()
  )
  or exists (
    select 1 from public.submissions s
    where s.storage_path = p_object_name and public.can_see_round(s.room_id, s.round)
  );
$$;

drop function public.reserve_upload(uuid, text);
drop table public.submission_uploads;

create function public.reserve_upload(p_room_id uuid, p_kind text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  r public.rooms;
  v_id uuid := gen_random_uuid();
  v_path text;
  v_hourly_limit integer := case p_kind when 'submission' then 20 else 10 end;
begin
  if p_kind = 'submission' then
    perform public._require_active_member(p_room_id, v_uid);
    select * into r from public.rooms where id = p_room_id;
    if r.status <> 'producing' then
      raise exception using errcode = 'P0001', message = 'wrong_phase';
    end if;
    if now() >= r.phase_ends_at then
      raise exception using errcode = 'P0001', message = 'deadline_passed';
    end if;
    v_path := v_id::text;
  elsif p_kind = 'avatar' then
    if not exists (select 1 from public.profiles where id = v_uid) then
      raise exception using errcode = 'P0001', message = 'profile_missing';
    end if;
  else
    raise exception using errcode = 'P0001', message = 'invalid_upload_kind';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('uploads:' || v_uid::text, 0));
  if (
    select count(*) from public.uploads
    where user_id = v_uid and kind = p_kind and created_at > now() - interval '1 hour'
  ) >= v_hourly_limit then
    raise exception using errcode = 'P0001', message = 'upload_rate_limited';
  end if;

  insert into public.uploads (id, user_id, kind, room_id, round, quarantine_path)
  values (v_id, v_uid, p_kind, r.id, r.round, v_path);
  return jsonb_build_object('upload_id', v_id, 'path', v_path);
end;
$$;

create function public.upload_hash_blocked(p_sha256 text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.blocked_hashes where sha256 = lower(p_sha256));
$$;

create function public.reject_upload(p_upload_id uuid, p_reason text) returns void
language sql
security definer
set search_path = ''
as $$
  update public.uploads set status = 'rejected', reject_reason = left(p_reason, 100)
  where id = p_upload_id and status = 'pending';
$$;

create function public.complete_upload(
  p_upload_id uuid,
  p_final_path text,
  p_mime text,
  p_size bigint,
  p_sha256 text,
  p_duration_ms integer default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  u public.uploads;
  v_stale text[] := '{}';
begin
  update public.uploads
  set status = 'verified', final_path = p_final_path, mime = p_mime, size = p_size, sha256 = lower(p_sha256),
      duration_ms = p_duration_ms
  where id = p_upload_id and status = 'pending'
  returning * into u;
  if u.id is null then
    raise exception using errcode = 'P0001', message = 'upload_not_pending';
  end if;

  if u.kind = 'avatar' then
    select coalesce(array_agg(final_path), '{}') into v_stale
    from public.uploads
    where user_id = u.user_id and kind = 'avatar' and id <> u.id and final_path is not null;
    update public.uploads set final_path = null where final_path = any(v_stale) and user_id = u.user_id;
    update public.profiles
    set avatar_url = (select avatar_base_url from public.app_config) || u.final_path
    where id = u.user_id;
  end if;
  return jsonb_build_object('stale_paths', to_jsonb(v_stale));
end;
$$;

create function public.clear_avatar(p_user_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stale text[];
begin
  update public.profiles set avatar_url = null where id = p_user_id;
  select coalesce(array_agg(final_path), '{}') into v_stale
  from public.uploads
  where user_id = p_user_id and kind = 'avatar' and final_path is not null;
  update public.uploads set final_path = null where final_path = any(v_stale) and user_id = p_user_id;
  return jsonb_build_object('stale_paths', to_jsonb(v_stale));
end;
$$;

drop function public.submit_track(uuid, text, integer);

create function public.submit_track(p_room_id uuid, p_upload_id uuid) returns jsonb
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
  set storage_path = excluded.storage_path, duration_ms = excluded.duration_ms, submitted_at = now()
  returning id into v_submission_id;

  perform public._advance_step(r.id);
  perform public._bump(r.id);
  return jsonb_build_object('submission_id', v_submission_id, 'replaced_path', v_previous);
end;
$$;

alter table public.app_config add column avatar_base_url text not null
  default 'https://ktdoekkxqcdtdmqyinlz.supabase.co/storage/v1/object/public/avatars/';

-- Only fires when avatar_url changes, so URLs set before this migration are grandfathered.
create function public.profiles_check_avatar_url() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix text := (select avatar_base_url from public.app_config) || new.id::text || '/';
begin
  if new.avatar_url is not null and (
    left(new.avatar_url, char_length(v_prefix)) <> v_prefix
    or substr(new.avatar_url, char_length(v_prefix) + 1) !~ '^[A-Za-z0-9_-]+\.webp$'
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_avatar_url';
  end if;
  return new;
end;
$$;

create trigger profiles_check_avatar_url_insert
before insert on public.profiles
for each row
when (new.avatar_url is not null)
execute function public.profiles_check_avatar_url();

create trigger profiles_check_avatar_url_update
before update of avatar_url on public.profiles
for each row
when (new.avatar_url is distinct from old.avatar_url)
execute function public.profiles_check_avatar_url();

create function public.stale_quarantine_objects(p_limit integer default 500) returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select name from storage.objects
  where bucket_id = 'quarantine' and created_at < now() - interval '1 hour'
  order by created_at
  limit p_limit;
$$;

create function public.submissions_due_for_purge(p_limit integer default 500)
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
  order by r.updated_at
  limit p_limit;
$$;

create function public.mark_submissions_purged(p_ids uuid[]) returns void
language sql
security definer
set search_path = ''
as $$
  update public.submissions set purged_at = now() where id = any(p_ids) and purged_at is null;
$$;

create function public.expire_uploads() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.uploads
  where status in ('pending', 'rejected') and created_at < now() - interval '1 hour';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('expire-uploads', '*/10 * * * *', 'select public.expire_uploads()');
  end if;
end;
$$;

revoke execute on function
  public.profiles_check_avatar_url(),
  public.upload_hash_blocked(text),
  public.reject_upload(uuid, text),
  public.complete_upload(uuid, text, text, bigint, text, integer),
  public.clear_avatar(uuid),
  public.stale_quarantine_objects(integer),
  public.submissions_due_for_purge(integer),
  public.mark_submissions_purged(uuid[]),
  public.expire_uploads()
from public, anon, authenticated;

grant execute on function
  public.upload_hash_blocked(text),
  public.reject_upload(uuid, text),
  public.complete_upload(uuid, text, text, bigint, text, integer),
  public.clear_avatar(uuid),
  public.stale_quarantine_objects(integer),
  public.submissions_due_for_purge(integer),
  public.mark_submissions_purged(uuid[])
to service_role;

revoke execute on function public.can_upload_quarantine(text), public.reserve_upload(uuid, text), public.submit_track(uuid, uuid)
from public, anon;
grant execute on function public.can_upload_quarantine(text), public.reserve_upload(uuid, text), public.submit_track(uuid, uuid)
to authenticated;

-- Storage uploads use insert ... returning, which also needs a matching select policy.
create policy "quarantine: read own reserved" on storage.objects
for select to authenticated
using (bucket_id = 'quarantine' and public.can_upload_quarantine(name));
