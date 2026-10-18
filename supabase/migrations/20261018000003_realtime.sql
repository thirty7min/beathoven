-- Broadcast-from-database on private topics `room:<room_id>`.
-- `room_state` carries the full public room state at a version; clients drop
-- anything older than what they hold. `chat` carries a single message.

-- Deferred so it runs at commit and sees the transaction's final state. If a
-- transaction bumped the version more than once, only the firing whose NEW
-- version matches the committed row broadcasts.
create function public.broadcast_room_state() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.version is distinct from (select version from public.rooms where id = new.id) then
    return null;
  end if;
  begin
    perform realtime.send(public._room_state(new.id), 'room_state', 'room:' || new.id::text, true);
  exception when others then
    raise warning 'room_state broadcast failed for room %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

create constraint trigger rooms_broadcast_state
after update on public.rooms
deferrable initially deferred
for each row
when (old.version is distinct from new.version)
execute function public.broadcast_room_state();

create function public.broadcast_chat_message() returns trigger
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
        'body', new.body,
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

create trigger chat_messages_broadcast
after insert on public.chat_messages
for each row execute function public.broadcast_chat_message();

revoke execute on function public.broadcast_room_state(), public.broadcast_chat_message()
from public, anon, authenticated;

-- Only active room members may join a room topic. Clients may publish
-- Presence but never Broadcast: all state changes come from the database.
create policy "room members receive room topic" on realtime.messages
for select to authenticated
using (
  realtime.messages.extension in ('broadcast', 'presence')
  and exists (
    select 1 from public.room_players rp
    where rp.user_id = (select auth.uid())
      and rp.left_at is null
      and 'room:' || rp.room_id::text = (select realtime.topic())
  )
);

create policy "room members track presence" on realtime.messages
for insert to authenticated
with check (
  realtime.messages.extension = 'presence'
  and exists (
    select 1 from public.room_players rp
    where rp.user_id = (select auth.uid())
      and rp.left_at is null
      and 'room:' || rp.room_id::text = (select realtime.topic())
  )
);
