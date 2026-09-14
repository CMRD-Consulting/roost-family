-- Reports whether the scheduled jobs Roost depends on are in place (spec §11.3, §15 launch gate). Read-only.
--   psql "$DATABASE_URL" -f supabase/manual-checks/cron_check.sql
-- Prints one READY / NOT READY line per requirement, then the jobs' recent runs. Run it against prod before launch and
-- after any restore; a NOT READY line means deleted households (or photo files) are not being purged.
\set QUIET 1
\pset footer off

select exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') as pg_cron_installed \gset

\if :pg_cron_installed
  \echo 'READY      pg_cron is installed'

  select exists (
    select 1 from cron.job
    where jobname = 'roost-purge-deleted-households' and active and command ilike '%private.purge_deleted_households()%'
  ) as purge_job \gset
  \if :purge_job
    \echo 'READY      roost-purge-deleted-households is scheduled and active'
  \else
    \echo 'NOT READY  roost-purge-deleted-households is missing or inactive. Schedule it (as postgres):'
    \echo '           select cron.schedule(''roost-purge-deleted-households'', ''17 3 * * *'', ''select private.purge_deleted_households()'');'
  \endif

  \echo ''
  \echo 'Roost jobs:'
  select jobid, jobname, schedule, active, command from cron.job where jobname like 'roost-%' order by jobname;

  \echo 'Last 10 runs (a failed status or no runs in the last day needs attention):'
  select j.jobname, r.status, r.start_time, r.end_time, left(r.return_message, 120) as return_message
  from cron.job_run_details r join cron.job j on j.jobid = r.jobid
  where j.jobname like 'roost-%'
  order by r.start_time desc
  limit 10;

  select count(*) as failed_last_7_days from cron.job_run_details r join cron.job j on j.jobid = r.jobid
  where j.jobname like 'roost-%' and r.status = 'failed' and r.start_time > now() - interval '7 days';
\else
  \echo 'NOT READY  pg_cron is not installed, so nothing purges deleted households.'
  \echo '           Enable it (Database > Extensions > pg_cron on hosted Supabase), then schedule the jobs:'
  \echo '           select cron.schedule(''roost-purge-deleted-households'', ''17 3 * * *'', ''select private.purge_deleted_households()'');'
\endif

select count(*) as households_overdue_for_purge from public.households
where deleted_at is not null and deleted_at < now() - interval '31 days';
