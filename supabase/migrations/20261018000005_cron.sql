-- Clients advance rooms themselves when a deadline passes; this sweep only
-- rescues rooms nobody is watching. Skipped where pg_cron isn't available
-- (e.g. the PGlite test harness).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('sweep-rooms', '15 seconds', 'select public.sweep_rooms()');
    perform cron.schedule(
      'prune-cron-history',
      '0 4 * * *',
      $job$delete from cron.job_run_details where end_time < now() - interval '1 day'$job$
    );
  end if;
end;
$$;
