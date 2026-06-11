-- v1b emotional shell: realtime surfaces + notification idempotency.

-- Realtime: broadcast pet growth and notifications so the web UI animates the
-- pet and shows celebrations live (mirrors 0006 for milestones).
-- postgres_changes respects RLS (the subscriber only sees their own rows).
alter publication supabase_realtime add table pets;
alter publication supabase_realtime add table notifications;

-- ★ Idempotency: a logical notification (dedup_key) is delivered at most once.
-- The deliver_notification worker inserts and treats a unique violation as
-- "already delivered" (same pattern as jobs_dedup_idx / evidence_idempotency_idx).
create unique index notifications_dedup_idx
  on notifications (dedup_key) where dedup_key is not null;
