-- Submissions live at `<room_id>/<round>/<user_id>/<file>` in a private bucket.
-- Players upload only into their own folder for the room's current round while
-- it is producing; other members can read once the round reaches listening.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'submissions', 'submissions', false, 52428800,
    array['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave',
          'audio/flac', 'audio/x-flac', 'audio/aac', 'audio/mp4', 'audio/x-m4a', 'audio/ogg', 'audio/webm']
  ),
  (
    'samples', 'samples', false, 20971520,
    array['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave',
          'audio/flac', 'audio/x-flac', 'audio/aac', 'audio/mp4', 'audio/x-m4a', 'audio/ogg', 'audio/webm']
  )
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create function public.can_upload_submission(p_object_name text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.rooms r
    join public.room_players rp on rp.room_id = r.id
    where r.id::text = (storage.foldername(p_object_name))[1]
      and r.round::text = (storage.foldername(p_object_name))[2]
      and (storage.foldername(p_object_name))[3] = auth.uid()::text
      and cardinality(storage.foldername(p_object_name)) = 3
      and r.status = 'producing'
      and r.phase_ends_at > now()
      and rp.user_id = auth.uid()
      and rp.left_at is null
  );
$$;

create function public.can_read_submission(p_object_name text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (storage.foldername(p_object_name))[3] = auth.uid()::text
    or exists (
      select 1
      from public.rooms r
      join public.room_players rp on rp.room_id = r.id
      where r.id::text = (storage.foldername(p_object_name))[1]
        and rp.user_id = auth.uid()
        and (
          r.round::text <> (storage.foldername(p_object_name))[2]
          or r.status in ('listening', 'results', 'lobby')
        )
    );
$$;

revoke execute on function public.can_upload_submission(text), public.can_read_submission(text) from public, anon;
grant execute on function public.can_upload_submission(text), public.can_read_submission(text) to authenticated;

create policy "submissions: upload own" on storage.objects
for insert to authenticated
with check (bucket_id = 'submissions' and public.can_upload_submission(name));

create policy "submissions: replace own" on storage.objects
for update to authenticated
using (bucket_id = 'submissions' and public.can_upload_submission(name))
with check (bucket_id = 'submissions' and public.can_upload_submission(name));

create policy "submissions: read in room" on storage.objects
for select to authenticated
using (bucket_id = 'submissions' and public.can_read_submission(name));

create policy "samples: read" on storage.objects
for select to authenticated
using (bucket_id = 'samples');
