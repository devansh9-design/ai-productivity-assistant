-- Remove redundant indexes introduced by the idempotent mapping migration.
-- The calendar primary key already indexes user_id, and the deployed
-- google_planner_events_user_plan_idx already covers (user_id, daily_plan_id).

drop index if exists public.google_planner_calendars_user_idx;
drop index if exists public.google_planner_events_user_plan_date_idx;
