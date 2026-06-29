-- 0011: drop the emotional shell (pet + collectibles + notifications).
--
-- Aimcub pivoted to a pure aim-management system: goals/milestones + evidence
-- ingestion + eval (judging) + memory + MCP (the human/agent connection point).
-- The "virtual pet + digital collectibles + proactive companion" layer is gone.
-- Milestone completion is still DERIVED state, but it no longer feeds pet growth,
-- badge minting, or pet-voice notifications.
--
-- Migrations are append-only; 0001-0010 stay as history. This migration removes
-- the shell objects from the deployed schema. `xp_reward` / `awarded_xp` are KEPT
-- as a neutral effort/contribution weight that still drives goal progress and is
-- an input to eval weighting — only the pet/collectible-specific surface is dropped.

-- ── pet-xp RPC ───────────────────────────────────────────────────────────────
-- Dropped first: its return type is `public.pets`, so it depends on the table.
drop function if exists upsert_pet_monotonic(uuid, uuid, int, text);

-- ── derived-state tables ─────────────────────────────────────────────────────
-- Dropping a table also removes its indexes, RLS policies, and realtime
-- publication membership (pets + notifications were added to supabase_realtime
-- in 0008; collectibles/pets unique backstops were added in 0010).
drop table if exists collectibles;
drop table if exists notifications;
drop table if exists pets;

-- ── collectible-only columns ────────────────────────────────────────────────
-- `milestones.rarity` only seeded the collectible shiny roll; the completion's
-- `minted_collectible_id` was the badge idempotency anchor. Both are obsolete.
alter table milestones drop column if exists rarity;
alter table milestone_completions drop column if exists minted_collectible_id;

-- ── jobs type domain ─────────────────────────────────────────────────────────
-- Tighten the CHECK to the surviving job kinds. Purge any orphaned shell jobs
-- first (they are dead — nothing enqueues or handles them anymore) so the new
-- constraint can be validated.
delete from jobs where type in ('grow_pet', 'mint_collectible', 'deliver_notification');
alter table jobs drop constraint if exists jobs_type_check;
alter table jobs add constraint jobs_type_check
  check (type in ('judge_evidence', 'extract_memory'));
