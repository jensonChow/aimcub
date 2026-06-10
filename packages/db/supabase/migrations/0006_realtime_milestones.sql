-- Realtime: broadcast milestone changes so the web UI lights milestones up live.
-- postgres_changes respects RLS (the subscriber only sees their own rows).
alter publication supabase_realtime add table milestones;
