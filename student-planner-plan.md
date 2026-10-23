# AI Student Planner: Phase 2 plan

**Status:** draft for review, 2026-10-20. Nothing in this plan has been built yet.
**Replaces:** the direction of `personal-ai-productivity-assistant-14-day-plan.md` (Phase 1, shipped). This plan reworks that app; it is not a rewrite.

## 1. What we're building

A planner for **college students**. A student sets long-term goals with deadlines, for example *"put on muscle in 2 months"* and *"be placement-ready in DSA by December"*, next to college classes and exams. The app turns them into a **month → week → day** plan and runs a daily loop:

> **Morning check-in** (time available, energy, classes or exams today) → **today's plan** → do the work → **evening log** (what got done, with numbers) → **AI feedback** that adjusts tomorrow and the week.

**Decisions already made:**

| Question | Decision |
|---|---|
| Who uses it | **Many students.** Open sign-up, each user's data private |
| How long-term plans are made | **The student chooses:** ask the AI to build the roadmap, or build it themselves with the AI helping on request |
| Daily input and output | **All three:** morning check-in, evening log, AI daily feedback |
| Codebase | **Rework this repo.** Keep what works, reshape the rest |

**Principles carried over from Phase 1:**
- The AI **proposes**; the student confirms. Nothing important changes silently.
- Every database change is a committed migration with row-level security (RLS) and database tests.
- Each step ends with tests, typecheck, lint, build and a manual browser check.
- It stays free to run: the Gemini, Supabase and Vercel free tiers.

## 2. What stays, what changes, what's new

| Area | Phase 1 today | Phase 2 |
|---|---|---|
| Sign-in, RLS, rate limits, logging, export, theme, layout | Done | **Keep** |
| Fast AI (Gemini 3.5 Flash-Lite, 2–3 s) | Done | **Keep**, and use it for roadmaps and feedback |
| Goals | Title, description, status | **Reshape:** category, start and target date, baseline → target metric, weekly hours |
| Projects + Milestones | Separate pages | **Fold into the goal roadmap** as phases and weekly targets. Pages hidden, data migrated |
| Tasks | One-off tasks | **Keep**, plus tasks generated from routines |
| Recurring work | None | **New:** routines such as gym Mon/Wed/Fri 60 min or 2 DSA problems a day |
| Daily plan engine + Google Calendar | Done | **Keep**, driven by the morning check-in. Calendar stays optional |
| Check-ins | Evening only (mood, wins, lesson) | **Split** into a morning check-in and an evening log with numbers |
| Progress | Analytics on tasks and time | **New:** per-goal metrics (weight, workouts, problems solved by topic) with charts |
| Views | Today, weekly review | **New:** week view and month view |
| AI | Chat proposals, weekly summary | **New:** roadmap builder, plan helper, daily feedback |
| Telegram and n8n | Deferred | Still deferred |
| First run | None | **New:** student onboarding |

## 3. Data model changes

All new tables follow the existing pattern: `user_id` defaults to `auth.uid()`, owner-only RLS for select/insert/update/delete, grants to `authenticated`, `updated_at` triggers, cross-user foreign-key checks, and database tests in `scripts/db-tests/`.

- **`profiles`**: add `display_name`, `college_year`, `timezone` and `onboarded_at`.
- **`goals`**: add `category` (`fitness | academics | placement | skill | other`), `start_date`, `target_date`, `weekly_hours`, `level` (`beginner | intermediate | advanced`) and `plan_source` (`ai | manual`).
- **`goal_metrics`**: what "progress" means for a goal. For example *body weight, kg, 60 → 65* or *DSA problems solved, 0 → 300*. One goal can have several.
- **`goal_phases`**: the roadmap. Ordered phases with dates, a focus and the target for the end of each phase, for example *"Weeks 1–3: arrays and strings, 60 problems"*. Replaces milestones for goals.
- **`weekly_targets`**: per goal and week, what this week should achieve, for example *4 gym sessions* or *15 problems: trees*.
- **`routines`**: recurring work for a goal. Title, days of the week, minutes, preferred time window, active dates, and the metric it feeds.
- **`tasks`**: add `routine_id` and `occurrence_date`, with a unique index on (`routine_id`, `occurrence_date`) so a routine creates each day's task only once.
- **`progress_logs`**: dated metric values (`goal_metric_id`, `log_date`, `value`, `note`), entered in the evening log.
- **`checkins`**: allow a `morning` type with `available_minutes`, `energy_level` and `notes`. Classes and exams stay in fixed commitments.
- **`daily_feedback`**: one row per user per day. The AI's summary, suggestions, and the adjustment proposals and their outcome (applied or dismissed).
- **Old data:** the Projects and Milestones features are removed in **Step 11**. Their tables only held Phase 1 test rows, so they are not moved into phases (decided 2026-10-22). A cleanup after Step 12 dropped the tables, with the owner's approval.

## 4. Build steps

Each step is a separate branch and PR, sized for one or two working sessions.

### Step 1: Data model v2
- Add migrations for every change in section 3. (Old projects and milestones are not migrated; see Step 11.)
- Add database tests: isolation between two users, routine occurrences can't be duplicated, metric validation.
- **Done when:** CI applies all migrations to a clean database, every database test passes, the live migration is applied, and the history matches the repo.

### Step 2: Student onboarding
- First sign-in runs a short wizard: name, year, timezone, the weekly college timetable (which becomes availability rules and fixed commitments), and the first goal (or skip).
- Settings can reopen any part of it.
- Replace the 5 starter goals that every new account gets today (DSA, Full-stack, Placements, College, Gym; created by the Day 2 signup trigger) with the goals the student picks in onboarding. Those starter goals have no dates, metrics or roadmap.
- **Done when:** a new account finishes onboarding in about 3 minutes without the Settings page, and a returning user never sees the wizard again.

### Step 3: Goals v2, the manual builder
- Create and edit a goal with category, dates, level, weekly hours and metrics.
- Add, reorder and edit phases, weekly targets and routines by hand.
- The goal page shows its roadmap as a timeline.
- **Done when:** a student can build the gym and DSA examples entirely by hand, and everything validates (phases within the goal's dates, routines within weekly hours).

### Step 4: AI roadmap builder
- **Build with AI:** goal, deadline, level, weekly hours, and optionally constraints ("exams 10–20 Nov", "gym only weekdays").
- The AI proposes phases, weekly targets, routines and metrics, checked by a validator with the same rules as the manual builder.
- The student edits the draft, then saves it, or asks the AI to revise it ("make it lighter in exam weeks").
- **Plan with AI help:** in the manual builder, a "Suggest" button per section (phases, routines, targets).
- **Done when:** the two examples produce sensible, valid roadmaps in under 10 s, nothing is saved before the student confirms, and invalid AI output never reaches the database.

### Step 5: Routines become daily tasks
- Every day's tasks come from active routines, created on first visit or by plan generation, exactly once per day.
- Skipping or moving one occurrence never changes the routine itself.
- **Done when:** a Mon/Wed/Fri gym routine shows up on exactly those days, a reload or second tab never duplicates it, and editing the routine changes only future days.

### Step 6: Morning check-in → today's plan
- Today opens with the morning check-in if it hasn't been done: free time, energy, anything special (exam, travel).
- Then it generates the plan with the existing engine, using routines, weekly targets, deadlines and Google Calendar (optional).
- Low energy or little time means a lighter plan, with priority on what keeps weekly targets on track.
- **Done when:** a check-in plus Generate gives a plan that fits the stated time, never clashes with classes or meetings, and says what was left out and why.

### Step 7: Evening log
- One screen: mark each planned item done, partly done or skipped (with a reason), enter numbers for the day's metrics (weight, problems solved by topic, workout details), and add a short note.
- It replaces the current evening check-in, and keeps mood and the lesson as optional fields.
- **Done when:** logging a typical day takes under 2 minutes, and the numbers show up in goal progress straight away.

### Step 8: AI daily feedback
- After the evening log, the AI writes a short, specific note, for example *"3/4 sessions this week, on track; DSA is 5 problems behind, so tomorrow's plan adds one"*.
- Any change it suggests to tomorrow, the week or a routine is a proposal to apply or dismiss.
- The note is checked against real numbers, the same way the weekly summary is checked today.
- **Done when:** feedback appears within about 5 s of saving the log, never states a number that doesn't match the data, and never changes a plan without confirmation.

### Step 9: Week view and weekly review v2
- **Week view:** each day's plan and completion, each goal's weekly target against actual, and routines kept.
- **Weekly review:** goal by goal, with the AI proposing next week's targets (accept or edit).
- **Done when:** a student can see on one screen whether each goal is on track this week, and set next week in under 3 minutes.

### Step 10: Month view and goal progress
- **Month view:** a calendar grid with a coloured completion level per day, exams and deadlines, and phase boundaries.
- **Goal page:** a progress chart per metric (actual against the target line), phase status, and an estimated finish ("at this pace: 2 weeks late").
- **Done when:** the gym and DSA goals each show a correct chart from logged data, and the month view loads in under 1 s.

### Step 11: Navigation and per-page UI
- New navigation: **Today · Week · Month · Goals · AI · Review · Settings**. The Projects, Milestones and Tasks pages are removed. Their old rows stay in the database unused (no migration).
- Analytics is folded into goal progress and the week view.
- This is the step for **your per-page UI instructions**, page by page, starting with Today.
- **Done when:** every page passes a desktop, phone and dark-mode check, with no dead pages or links left.

### Step 12: Multi-user launch readiness
- Account basics: email confirmation, password reset, delete account (with data export first), and a privacy page.
- **AI quota:** per-user limits stay, plus a check that a heavy user can't exhaust the shared Gemini free quota. Lower daily limits or a waitlist if needed.
- **Google Calendar for other students:** it stays **optional**. Before more than 100 users can connect it, Google requires app verification for the calendar scope. Until then: test-user list or the "unverified app" screen.
- Full QA with two or three real students: a first week from sign-up.
- **Done when:** a new student can sign up, onboard, plan and log for a week with no help and no manual database edits, and the release criteria below pass.

## 5. Release criteria

- A new student goes from sign-up to a first day plan in under 5 minutes.
- Long-term goals show a roadmap down to weekly targets and daily tasks, built by the AI or by hand.
- Morning check-in → plan → evening log → feedback works every day, with each step under 2 minutes.
- Plans never clash with classes, exams or calendar events, and they fit the stated free time.
- Progress per goal is visible as numbers and a chart, against the target.
- The AI never changes data without confirmation, and its feedback matches the logged numbers.
- One student can never see or change another student's data, as shown by the RLS and database tests.
- The app stays within the free tiers at the expected number of students.

## 6. Decisions on the open questions (2026-10-20)

1. **Timeline:** finish Phase 2 as soon as possible. Steps run back to back.
2. **Phone or desktop first:** phone first for the morning check-in and evening log; desktop first for building goals and roadmaps.
3. **Metrics for the first release:** body weight, workouts done, DSA problems solved (by difficulty), and hours studied. Students can add their own numeric metrics.
4. **College timetable:** typed into a weekly grid during onboarding. Import comes later.
5. **Reminders:** not in Phase 2.
6. **AI feedback tone:** short, direct and encouraging, built on the student's real numbers.

## 7. Later (not in this phase)

PWA install and push notifications, voice input, Telegram, LeetCode or GitHub activity import, study groups or accountability partners, and a native mobile app. Also issue #16 (plan tomorrow the evening before); Step 6 may cover it.
