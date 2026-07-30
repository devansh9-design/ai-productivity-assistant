-- Day 2 follow-up fix: grant base-level table privileges to the
-- `authenticated` role.
--
-- Row Level Security policies only filter which ROWS a role can see once
-- that role is already permitted to touch the table at all. RLS is not a
-- substitute for the underlying Postgres GRANT — without it, every query
-- from the client fails with "permission denied for table <name>" before
-- RLS ever gets a chance to evaluate.
--
-- Day 1's `profiles` table happened to work without this because its only
-- client-facing write path is the `handle_new_user` trigger, which runs as
-- `security definer` (as `postgres`) and bypasses role grants entirely.
-- goals/projects/milestones/tasks/task_dependencies/task_sessions have no
-- such trigger for client reads/writes, so they need explicit grants.
--
-- Kept as its own migration (rather than editing
-- 20260731000000_goals_projects_tasks.sql in place) because that migration
-- may already be marked "applied" in the project's migration history table;
-- editing an already-applied migration's file content is not picked up by
-- Supabase, so the fix must ship as a new migration instead.

grant select, insert, update, delete on public.goals to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.milestones to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
grant select, insert, update, delete on public.task_dependencies to authenticated;
grant select, insert, update, delete on public.task_sessions to authenticated;
grant select, update on public.profiles to authenticated;
