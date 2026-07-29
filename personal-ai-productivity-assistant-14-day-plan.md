# Personal AI Productivity Assistant — 14-Day Build Plan

## Outcome

Ship a secure, personal web app that tracks goals and tasks, creates realistic daily plans around Google Calendar, sends Telegram check-ins, supports AI-assisted replanning, and produces weekly insights.

This is a **complete personal beta**, not a multi-user SaaS. It intentionally excludes native mobile, voice, Gmail parsing, automated LeetCode scraping, Notion sync, and complex long-term vector memory.

## Target architecture

```text
Web app / Telegram
        |
Next.js + TypeScript API routes
        |------------------------ OpenAI Responses API (chat and proposals)
        |------------------------ Google Calendar API (availability + confirmed blocks)
        |------------------------ n8n webhooks (automation triggers)
        |
Supabase: Auth + PostgreSQL + RLS
        |
n8n: scheduled workflows + Telegram delivery + integration orchestration
```

## Non-negotiable design rules

1. The scheduling algorithm—not AI—decides whether a schedule is possible.
2. AI may propose changes, but all writes are validated by the server.
3. Calendar writes require an explicit **Confirm plan** action.
4. Generated work blocks go only into a separate Google Calendar named `AI Planner`.
5. Never expose API keys or OAuth tokens in browser code, commits, prompts, or screenshots.
6. Work one vertical feature at a time; do not start the next day until the current acceptance checks pass.
7. Use AI as a builder and reviewer, but keep a single source of truth: this repository and its migrations.
8. Use n8n for recurring workflows and notifications; keep authorization, scheduling rules, and validated data writes inside the application.

## Delivery rhythm

Plan on 5–7 focused hours per day. If you have fewer hours, spread the plan across more calendar days; do not reduce testing.

For every feature:

1. Create a Git branch and a small issue/checklist.
2. Give the implementation prompt to Codex.
3. Run the generated app and perform the acceptance checks yourself.
4. Ask a second AI for a focused review.
5. Give review findings back to Codex as a separate fix request.
6. Commit only after checks pass.

## Tools to use

| Need | Tool | How to use it |
|---|---|---|
| Main implementation | Codex | Give it one feature brief at a time; let it inspect, edit, test, and explain changes. |
| Backend/database | Supabase | Use Postgres, Auth, Row-Level Security, migrations, and scheduled jobs. |
| Workflow automation | n8n | Build recurring Telegram, review, and sync workflows; call app webhooks rather than placing business rules in n8n. |
| AI feature inside the app | OpenAI Responses API | Run it only from server-side routes and require structured, validated proposals. |
| Calendar | Google Calendar API | Read events first; write only confirmed work blocks to `AI Planner`. |
| Notifications | Telegram Bot API | Start with `/today`, `/done`, `/skip`, and scheduled messages. |
| Second opinion | ChatGPT or Claude | Review designs, migrations, security, test coverage, and prompts—do not use it to create a competing codebase. |
| Optional UI starter | v0, Lovable, or Bolt | Generate a dashboard mock-up once; then move its useful UI into the main repository. |
| Deployment | Vercel + Supabase | Deploy after the complete flow works locally. |

## Standard AI prompts

### Implementation prompt

```text
You are implementing one production-quality feature in an existing Next.js + TypeScript + Supabase app.

First inspect the repository, existing schema, and conventions. Then propose a short plan.
Implement only the feature below. Use migrations for all database changes. Do not expose secrets. Preserve existing behavior.

Feature:
[paste the day’s feature]

Acceptance criteria:
[paste the day’s checks]

Before finishing:
1. Run lint, type checks, and relevant tests.
2. Add or update tests for important logic.
3. List changed files, commands run, and any manual setup still required.
```

### Review prompt

```text
Review this implementation as a senior Next.js, TypeScript, Supabase, and security engineer.

Focus only on:
- authorization and Row-Level Security;
- database migration safety;
- API key or token exposure;
- timezone and calendar edge cases;
- duplicate job/request safety;
- missing test cases;
- unnecessary complexity.

Return prioritized, actionable findings only. Do not rewrite the project.
```

### Test-case prompt

```text
Create a manual QA checklist and edge-case dataset for this feature.
Cover: empty state, invalid input, duplicate submissions, network failure, timezone handling, mobile layout, authorization, and data consistency.
```

---

# Day-by-day schedule

## Day 1 — Foundation, accounts, and app shell

### Goal

Create the repository, application shell, Supabase project, login, and a responsive dashboard layout.

### Tasks

1. Create a private GitHub repository.
2. Create a Supabase project and record only public project URL/anon key in local environment files.
3. Create a Next.js TypeScript project with Tailwind and a component library.
4. Add `.env.example`; add `.env.local` to `.gitignore`.
5. Configure Supabase Auth with email/password authentication.
6. Build pages: Sign in, Today, Tasks, Goals, Analytics, Settings.
7. Add navigation, loading states, empty states, and a simple dark mode.
8. Deploy a basic preview to Vercel.

### Codex feature brief

```text
Set up the initial app shell for a single-user personal productivity assistant.
Implement Supabase email/password authentication, protected routes, responsive sidebar navigation, and placeholder pages for Today, Tasks, Goals, Analytics, and Settings.
Use TypeScript, Tailwind, and accessible components. Add .env.example and ensure secrets cannot be committed.
```

### Acceptance checks

- You can register, log in, log out, and cannot view protected pages while logged out.
- The app works at desktop and phone width.
- No secret appears in browser source or Git history.
- Production preview loads successfully.

### End-of-day deliverable

An authenticated, deployed application shell.

## Day 2 — Database, goals, projects, milestones, and tasks

### Goal

Create the product’s durable data model and task-management workflow.

### Required tables

```text
profiles
goals
projects
milestones
tasks
task_dependencies
task_sessions
```

### Task fields

```text
title, description, category, status, priority,
estimated_minutes, actual_minutes, due_date,
energy_level, goal_id, project_id, milestone_id,
created_at, updated_at, completed_at
```

### Tasks

1. Write a migration for all Day 2 tables.
2. Enable RLS on every user-owned table.
3. Add policies so a user can read/write only their own data.
4. Build CRUD pages for goals, projects, milestones, and tasks.
5. Add task filters: Inbox, Today, Due soon, Overdue, Completed.
6. Seed real goals: DSA, full-stack, placements, college, gym.

### Acceptance checks

- You can create a goal → project → milestone → task hierarchy.
- You can enter estimate, deadline, priority, and energy level.
- Completed tasks remain visible in history.
- A second test account cannot read the first account’s records.
- Migration can run on a clean database.

### End-of-day deliverable

Reliable task and goal tracking with secure ownership rules.

## Day 3 — Today workflow, completion tracking, and reflections

### Goal

Make the app useful before adding integrations: you should be able to run a real day from it.

### Tasks

1. Build the Today screen with top three priorities, task list, progress, and quick actions.
2. Add statuses: `todo`, `in_progress`, `completed`, `skipped`, `deferred`.
3. Add a completion action that stores actual minutes.
4. Add skip/defer reason capture.
5. Create `checkins` and `journal_entries` tables.
6. Build an evening check-in: mood, energy, distractions, wins, lesson, free-text reflection.
7. Add a simple task-session timer if time remains; do not let it delay the main flow.

### Acceptance checks

- You can see the day’s priorities and mark work completed, skipped, or deferred.
- Actual time and skip reason are saved.
- One evening reflection is saved and visible later.
- Empty state gives a clear next action.

### End-of-day deliverable

A manual daily operating loop: choose work, do it, record the outcome.

## Day 4 — Deterministic schedule engine

### Goal

Build the schedule engine without AI. It must produce a valid schedule using availability and task data.

### Rules to implement

1. Fixed events are immutable.
2. Reserve sleep, meals, travel, breaks, and 20% buffer time.
3. Schedule at most three must-do tasks.
4. Score tasks using urgency, impact, priority, deadline, and estimated duration.
5. Prefer high-energy tasks in high-focus windows.
6. Never overlap blocks.
7. If a task does not fit, put it in `unscheduled` with a reason.
8. Schedule only within configured working hours.

### Suggested tables

```text
availability_rules
daily_plans
plan_blocks
```

### Acceptance checks

- With no events, it creates a plan based on configured availability.
- With conflicting commitments, it creates no overlaps.
- It reserves the configured buffer.
- It never schedules more than three must-do tasks.
- It clearly identifies tasks that did not fit.
- Unit tests cover no availability, too many tasks, deadline urgency, and overlapping events.

### End-of-day deliverable

A testable schedule engine that can run independently of AI.

## Day 5 — Plan generation, editing, and confirmation

### Goal

Turn the scheduling engine into a complete plan workflow.

### Tasks

1. Build a timeline view for the daily plan.
2. Generate and save a proposed plan.
3. Allow moving/removing a block manually.
4. Add regenerate with preserved manual changes where feasible.
5. Add `draft`, `confirmed`, `superseded`, and `completed` plan states.
6. Add an explicit Confirm Plan action.
7. Keep a read-only history of older plans.

### Acceptance checks

- Generated plans are editable before confirmation.
- A confirmed plan cannot be silently overwritten.
- Regeneration produces a new version or explicit confirmation.
- Planned blocks are linked to tasks and can later be marked complete.

### End-of-day deliverable

A complete daily-plan workflow ready for calendar and AI connections.

## Day 6 — Google Calendar read integration

### Goal

Use Google Calendar to calculate real availability.

### Tasks

1. Configure Google OAuth consent and credentials.
2. Add server-side OAuth callback and secure token storage.
3. Request the smallest viable Calendar scope.
4. Sync upcoming events for today and the next seven days.
5. Normalize all timestamps to the user’s timezone.
6. Display calendar events in the planning timeline.
7. Feed events into the deterministic schedule engine.

### Acceptance checks

- You can connect and disconnect Google Calendar.
- Calendar events appear in the right timezone.
- Existing events are treated as unavailable time.
- Revoked or expired tokens fail safely and ask for reconnection.
- No OAuth token is sent to the browser.

### End-of-day deliverable

Calendar-aware plans, still read-only.

## Day 7 — Assistant calendar, n8n, and Telegram

### Goal

Add a safe write path and phone-first interaction.

### Tasks

1. Create or select a separate Google Calendar named `AI Planner`.
2. On Confirm Plan, create plan blocks only in this calendar.
3. Make write operations idempotent using stored external event IDs.
4. Set up n8n (n8n Cloud for speed, or self-hosted only if you already operate a server).
5. Create a Telegram bot and store the chat ID only after explicit linking.
6. Create n8n workflows for: morning-plan delivery, evening-check-in delivery, and a webhook receiver for `/today` and `/plan`.
7. Have n8n call authenticated app API/webhook endpoints; the app returns a formatted plan or performs validated actions.
8. Keep `/done <task>` and `/skip <task>` server-validated; n8n forwards the command but does not directly modify Supabase tables.

### Acceptance checks

- Confirming a plan creates blocks once, without duplication on retry.
- Existing personal/college events are never edited.
- Telegram commands update only your own account.
- Invalid commands return helpful guidance.
- Telegram messages are formatted correctly on mobile.
- An n8n retry does not duplicate calendar blocks or task updates.

### End-of-day deliverable

The assistant appears in your calendar and can be used from Telegram.

## Day 8 — AI chat and structured planning proposals

### Goal

Add natural-language assistance without giving the model uncontrolled access.

### AI context to send

```text
user preferences
today’s date and timezone
current daily plan
calendar events / availability
incomplete tasks
goal and milestone progress
recent check-ins (compact summary)
```

### Tool/proposal types

```text
get_today_context
suggest_schedule
propose_reschedule
propose_task_draft
summarize_day
```

### Tasks

1. Add a server-only OpenAI API route.
2. Build chat UI with streaming response if desired.
3. Require structured proposal output with a strict schema.
4. Validate proposal fields server-side.
5. Show a preview and require user confirmation before writes.
6. Save conversations and proposal outcomes for debugging.

### Acceptance checks

- “I have two hours tonight” yields an actionable proposal.
- The model cannot create overlaps or modify completed tasks.
- Invalid model output is rejected safely.
- No API key reaches the browser.
- User sees why tasks were chosen or deferred.

### End-of-day deliverable

A safe conversational planning assistant.

## Day 9 — Preferences, reflections, and adaptive replanning

### Goal

Make plans feel personal using structured data, not premature RAG complexity.

### Tasks

1. Add settings for focus windows, working hours, buffer, sleep, gym, and reminder times.
2. Generate a compact preference summary from settings and recent check-ins.
3. Add “low energy,” “behind schedule,” and “free time available” replanning actions.
4. Teach the planner to use actual versus estimated duration when available.
5. Create basic insights such as “you often defer long tasks after 9 PM.”

### Acceptance checks

- Low-energy replan uses lighter/shorter work.
- A missed block can be deferred without corrupting the plan.
- Preferences change future plans.
- The app works when no reflection history exists.

### End-of-day deliverable

Adaptive planning based on your stated preferences and real behavior.

## Day 10 — Analytics dashboard

### Goal

Turn raw task data into decision-useful feedback.

### Required metrics

```text
completion rate
planned vs actual minutes
completed time by category
overdue tasks
daily streak
tasks skipped/deferred by reason
goal and milestone progress
```

### Tasks

1. Create SQL views or server-side aggregation queries.
2. Build a weekly dashboard with no more than five charts/cards.
3. Include a date-range selector.
4. Ensure analytics excludes deleted/invalid records.
5. Add plain-language explanations next to each metric.

### Acceptance checks

- Metrics match manually checked sample data.
- No chart breaks on empty data.
- Category totals and task-session totals agree.
- Dashboard is usable on a phone.

### End-of-day deliverable

Useful, trustworthy productivity analytics.

## Day 11 — Weekly review and next-week planning

### Goal

Close the weekly feedback loop.

### Tasks

1. Create a weekly-review page.
2. Calculate completed work, missed tasks, hours, streak, and category focus.
3. Generate a concise AI summary grounded only in calculated metrics and check-ins.
4. Let the user choose next week’s three priorities.
5. Create a draft weekly plan or task shortlist; do not auto-fill every day.
6. Schedule a Sunday Telegram reminder.

### Acceptance checks

- Weekly report is correct for an empty week and a busy week.
- AI summary does not invent accomplishments.
- Next-week priorities become tasks or planned candidates.
- User can revise recommendations before saving.

### End-of-day deliverable

A weekly review that makes the next week more realistic.

## Day 12 — n8n automations and basic integrations

### Goal

Implement only integrations that save genuine manual work.

### Scope

- Morning plan workflow.
- Evening check-in workflow.
- Sunday review workflow.
- Calendar-sync workflow.
- Optional basic GitHub contribution/activity import.

### Tasks

1. Build each recurring workflow in n8n using Schedule Trigger → app webhook/API → Telegram message.
2. Pass an idempotency/run key from n8n; the application records it and ignores duplicate requests.
3. Configure n8n retry/error handling and a failure notification to Telegram or email.
4. Add notification preferences and quiet hours; the application must enforce them even if an n8n workflow runs.
5. If adding GitHub, use an n8n workflow to call GitHub, then send normalized activity to an authenticated app endpoint. Display simple activity/progress only—do not infer productivity from commits.
6. Add an integration status page with last-sync time, latest n8n run result, and reconnect action.

### Acceptance checks

- An n8n workflow retry cannot send duplicate Telegram messages or task changes.
- Workflows respect timezone and quiet hours.
- Failed integration is visible in the UI.
- Disabling an integration stops its jobs.

### End-of-day deliverable

Reliable, limited n8n automation that removes daily friction without making n8n the source of truth.

## Day 13 — Security, reliability, and full QA

### Goal

Prepare the app for your real personal data.

### Tasks

1. Review every table for RLS and write policies.
2. Verify all server routes require a user session where appropriate.
3. Confirm service-role credentials are server-only.
4. Add rate limiting to AI and Telegram endpoints.
5. Add error logging/monitoring.
6. Add loading, error, offline, and reconnect states.
7. Export a user-data JSON backup endpoint.
8. Run the full QA checklist below.

### Full QA checklist

- Sign up, login, logout, session expiry.
- Add/edit/delete a goal, project, milestone, task.
- Create a plan with and without calendar events.
- Regenerate and confirm a plan.
- Create calendar blocks and retry confirmation.
- Complete, skip, and defer tasks.
- Use each Telegram command.
- Ask AI to replan with too little available time.
- Disconnect calendar and Telegram.
- Test phone-width layout.
- Test with empty database and realistic data.

### End-of-day deliverable

A secure, tested release candidate.

## Day 14 — Deployment and real-life pilot

### Goal

Deploy the full app and use it for a real day.

### Tasks

1. Configure production environment variables in Vercel/Supabase.
2. Deploy production.
3. Verify OAuth redirect URLs and Telegram webhook/configuration.
4. Create your actual goals, tasks, availability, gym, and study preferences.
5. Connect your real Google Calendar and Telegram account.
6. Generate tomorrow’s plan, confirm it, and verify calendar blocks.
7. Complete an end-to-end pilot: morning message → work → completion → evening review.
8. Record every friction point as a backlog issue; fix only release-blocking defects now.

### Release criteria

- You can use it tomorrow without manual database edits.
- Plans never overlap real calendar events.
- Telegram messages arrive once at the configured times.
- AI proposes rather than silently changes important data.
- You can recover from expired credentials or an integration error.

---

# Post-launch backlog

Do not start these until you have used the app for two weeks and know what is actually missing.

1. PWA installability and push notifications.
2. Voice capture and voice planning.
3. Proper semantic memory with pgvector.
4. LeetCode data import where permitted.
5. Notion or Google Tasks import.
6. Job-application and interview tracker.
7. GitHub project milestones.
8. Exportable monthly report.
9. Native mobile application.

# Daily completion checklist

Before ending each build day:

- [ ] Feature acceptance criteria pass.
- [ ] Type check and lint pass.
- [ ] Important logic has tests.
- [ ] Manual QA passed in the browser.
- [ ] Second-AI review findings are addressed or recorded.
- [ ] Database changes use a committed migration.
- [ ] No secrets are staged for commit.
- [ ] Changes are committed with a clear message.
- [ ] Tomorrow’s feature is written as a small, testable brief.

# Definition of finished

The project is finished for this release when you can open the app or Telegram each day, see real availability, confirm a practical plan, complete or defer work, receive an evening review, and use the weekly review to choose the next week’s priorities.
