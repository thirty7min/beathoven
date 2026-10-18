create or replace function public.record_submission_loudness(
  p_submission_id uuid,
  p_storage_path text,
  p_ok boolean,
  p_lufs real default null,
  p_true_peak real default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room_id uuid := (select room_id from public.submissions where id = p_submission_id);
  r public.rooms;
begin
  if v_room_id is null then
    return false;
  end if;
  r := public._lock_room(v_room_id);

  if p_ok then
    update public.submissions
    set loudness_lufs = case when p_lufs between -100 and 30 then p_lufs end,
        true_peak_dbtp = case when p_true_peak between -150 and 40 then p_true_peak end,
        loudness_status = 'done',
        loudness_attempts = loudness_attempts + 1
    where id = p_submission_id and storage_path = p_storage_path;
  else
    update public.submissions
    set loudness_attempts = loudness_attempts + 1,
        loudness_status = case when loudness_attempts + 1 >= 3 then 'failed' else 'pending' end
    where id = p_submission_id and storage_path = p_storage_path and loudness_status <> 'done';
  end if;
  if not found then
    return false;
  end if;

  if p_ok and r.status = 'producing' then
    perform public._bump(r.id);
  end if;
  return true;
end;
$$;
