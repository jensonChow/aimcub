-- Enable the scheduling + HTTP extensions used by the jobs worker.
-- The actual cron.schedule() entry is added when the jobs-worker Edge Function is deployed.
create extension if not exists pg_cron;
create extension if not exists pg_net;
