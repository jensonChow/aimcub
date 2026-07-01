-- Typed context signals for v1b planning memory.
alter table memories
  add column if not exists category text not null default 'project_fact'
  check (category in ('preference','constraint','capability','eval_signal','project_fact','procedure'));

create index if not exists memories_owner_category_idx
  on memories (owner_id, category)
  where status = 'active';
