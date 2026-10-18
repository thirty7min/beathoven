create function public._guest_username() returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := 'abcdefghijklmnopqrstuvwxyz0123456789';
  v_username text;
begin
  loop
    v_username := 'guest_' || (
      select string_agg(substr(v_alphabet, 1 + floor(random() * 36)::integer, 1), '')
      from generate_series(1, 6)
    );
    exit when not exists (select 1 from public.profiles where lower(username) = v_username);
  end loop;
  return v_username;
end;
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display_name text := btrim(regexp_replace(coalesce(new.raw_user_meta_data ->> 'display_name', ''), '\s+', ' ', 'g'));
  v_username text;
begin
  if coalesce(new.is_anonymous, false) then
    for attempt in 1..5 loop
      v_username := public._guest_username();
      begin
        insert into public.profiles (id, username, display_name)
        values (new.id, v_username, case when public.valid_display_name(v_display_name) then v_display_name else v_username end);
        return new;
      exception when unique_violation then
        if attempt = 5 then
          raise;
        end if;
      end;
    end loop;
  else
    insert into public.profiles (id, username)
    values (new.id, 'producer_' || substr(replace(new.id::text, '-', ''), 1, 10));
  end if;
  return new;
end;
$$;

revoke execute on function public._guest_username() from public, anon, authenticated;
