-- Preserve low-priority context without feeding it into default planning.
alter table memories
  drop constraint if exists memories_status_check;

alter table memories
  add constraint memories_status_check
  check (status in ('active','pending','deprioritized','deleted'));
