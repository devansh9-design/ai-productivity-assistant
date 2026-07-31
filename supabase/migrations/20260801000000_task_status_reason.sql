-- Day 3 (part 1): capture a reason when a task is skipped or deferred.
-- Kept as a single nullable column rather than two (skip_reason/defer_reason)
-- since a task can only be in one of those states at a time — a single
-- "why is this not in progress right now" field covers both, and the
-- application layer clears it whenever status moves away from
-- skipped/deferred so a stale reason never lingers on a reopened task.

alter table public.tasks
  add column if not exists status_reason text check (status_reason is null or char_length(status_reason) <= 500);

comment on column public.tasks.status_reason is
  'Why the task was skipped or deferred. Cleared by the app whenever status is not skipped/deferred.';
