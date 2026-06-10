-- Defense in depth: an evidence row's goal (and milestone, when set) must belong
-- to the same owner. Without this, a valid emitter of user A could attach
-- evidence to user B's goal/milestone and drive B's auto-completion.
-- Mirrors assert_evidence_emitter_owner (0001/0003).

create or replace function assert_evidence_refs_owner() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  g_owner uuid;
  m_goal uuid;
  m_owner uuid;
begin
  select owner_id into g_owner from public.goals where id = new.goal_id;
  if g_owner is null or g_owner <> new.owner_id then
    raise exception 'goal % does not belong to owner %', new.goal_id, new.owner_id;
  end if;
  if new.milestone_id is not null then
    select goal_id, owner_id into m_goal, m_owner from public.milestones where id = new.milestone_id;
    if m_goal is null or m_goal <> new.goal_id or m_owner <> new.owner_id then
      raise exception 'milestone % does not belong to goal % / owner %',
        new.milestone_id, new.goal_id, new.owner_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger evidence_refs_owner_guard
  before insert or update on evidence
  for each row execute function assert_evidence_refs_owner();
