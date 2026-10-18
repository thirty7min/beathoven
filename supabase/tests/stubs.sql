
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

grant usage on schema public to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  is_anonymous boolean not null default false,
  created_at timestamptz not null default now()
);

create function auth.uid() returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create schema realtime;
grant usage on schema realtime to anon, authenticated, service_role;

create table realtime.messages (
  id bigint generated always as identity primary key,
  topic text not null,
  extension text not null,
  event text,
  payload jsonb,
  private boolean,
  inserted_at timestamptz not null default now()
);

alter table realtime.messages enable row level security;
grant select, insert on realtime.messages to authenticated;

create function realtime.topic() returns text
language sql
stable
as $$
  select nullif(current_setting('realtime.topic', true), '');
$$;

create function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void
language sql
as $$
  insert into realtime.messages (topic, extension, event, payload, private)
  values (topic, 'broadcast', event, payload, private);
$$;

create schema storage;
grant usage on schema storage to anon, authenticated, service_role;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid,
  created_at timestamptz not null default now(),
  unique (bucket_id, name)
);

alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.objects to anon;
grant all on storage.objects, storage.buckets to service_role;

create function storage.foldername(name text) returns text[]
language plpgsql
immutable
as $$
declare
  parts text[] := string_to_array(name, '/');
begin
  return parts[1 : array_length(parts, 1) - 1];
end;
$$;
