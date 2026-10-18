create function public.allowed_daws() returns text[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select array[
    'ableton-live', 'fl-studio', 'logic-pro', 'pro-tools', 'cubase', 'studio-one', 'bitwig-studio', 'reaper',
    'reason', 'garageband', 'bandlab', 'maschine', 'mpc', 'cakewalk', 'renoise', 'lmms', 'ardour'
  ]::text[];
$$;

create function public.valid_daws(p_daws text[]) returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_daws is not null
    and coalesce(array_ndims(p_daws), 1) = 1
    and cardinality(p_daws) <= 3
    and array_position(p_daws, null) is null
    and p_daws <@ public.allowed_daws()
    and cardinality(p_daws) = (select count(distinct d) from unnest(p_daws) d);
$$;

alter table public.profiles
  add column daws text[] not null default '{}' constraint profiles_daws_valid check (public.valid_daws(daws)),
  add column link_url text constraint profiles_link_url_format check (link_url like 'https://%' and char_length(link_url) <= 200);

grant update (daws) on public.profiles to authenticated;

create table public.blocked_domains (
  domain text primary key constraint blocked_domains_format check (domain ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$'),
  reason text not null default '',
  created_at timestamptz not null default now()
);

alter table public.blocked_domains enable row level security;
revoke all on public.blocked_domains from anon, authenticated;

create table public.profile_link_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index profile_link_attempts_user_created_idx on public.profile_link_attempts (user_id, created_at desc);

alter table public.profile_link_attempts enable row level security;
revoke all on public.profile_link_attempts from anon, authenticated;

create table public.link_checks (
  url text primary key,
  checked_at timestamptz not null default now()
);

create index link_checks_checked_at_idx on public.link_checks (checked_at);

alter table public.link_checks enable row level security;
revoke all on public.link_checks from anon, authenticated;

create function public.claim_link_attempt(p_user_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('profile-link:' || p_user_id::text, 0));
  delete from public.profile_link_attempts
  where user_id = p_user_id and created_at <= now() - interval '1 hour';
  if (select count(*) from public.profile_link_attempts where user_id = p_user_id) >= 10 then
    raise exception using errcode = 'P0001', message = 'link_rate_limited';
  end if;
  insert into public.profile_link_attempts (user_id) values (p_user_id);
end;
$$;

create function public.link_domain_blocked(p_host text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.blocked_domains b
    where b.domain in (
      select array_to_string(s.labels[i:], '.')
      from (select string_to_array(lower(btrim(p_host, '.')), '.') as labels) s,
        generate_series(1, cardinality(s.labels)) i
    )
  );
$$;

create function public.set_profile_link(p_user_id uuid, p_url text) returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set link_url = p_url where id = p_user_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'profile_not_found';
  end if;
  return p_url;
end;
$$;

create function public.record_link_check(p_url text) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.link_checks where checked_at < now() - interval '1 day';
  insert into public.link_checks (url) values (p_url)
  on conflict (url) do update set checked_at = now();
end;
$$;

create function public.get_profile_link(p_username text) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', p.id,
    'username', p.username,
    'link_url', p.link_url,
    'checked_recently', exists (
      select 1 from public.link_checks c
      where c.url = p.link_url and c.checked_at > now() - interval '1 day'
    )
  )
  from public.profiles p
  where lower(p.username) = lower(btrim(p_username));
$$;

create function public.clear_unsafe_link(p_user_id uuid, p_url text) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.link_checks where url = p_url;
  update public.profiles set link_url = null where id = p_user_id and link_url = p_url;
  return found;
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

revoke execute on function
  public.claim_link_attempt(uuid),
  public.link_domain_blocked(text),
  public.set_profile_link(uuid, text),
  public.record_link_check(text),
  public.get_profile_link(text),
  public.clear_unsafe_link(uuid, text)
from public, anon, authenticated;

grant execute on function
  public.claim_link_attempt(uuid),
  public.link_domain_blocked(text),
  public.set_profile_link(uuid, text),
  public.record_link_check(text),
  public.get_profile_link(text),
  public.clear_unsafe_link(uuid, text)
to service_role;
