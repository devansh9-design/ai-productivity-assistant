# Release readiness check — October 16, 2026

Checked the local Day 12 checkout, GitHub branches/PRs/Actions, Vercel deployment metadata and production alias, live Supabase metadata and selected test records, and the signed-in production browser. This is an inspection report, not release approval or a complete security audit.

## Conclusion

Day 12 is implemented and automated checks pass. Release readiness remains unverified. Production serves an older Day 12 commit. Analytics encountered an intermittent authentication error and subsequently recovered; the timer-precedence display has now been verified. A local read-retry mitigation is prepared but is not deployed, and the authentication root cause remains unproven.

## Source and deployments

| Location | Verified state |
| --- | --- |
| Local checkout and GitHub `day-12` | `a5245faf297fa1d7d026b8e9ae8e92658e6dc5da` |
| GitHub `main` | `4e8b63463472d078fc6c109b08092d0fd7b089f8`, Day 11 merge |
| Day 11 PR | [#12](https://github.com/devansh9-design/ai-productivity-assistant/pull/12), merged |
| Open PRs | None at inspection time; no open Day 12 PR |
| Latest Day 12 deployment | `dpl_6vPu8eGqdjK8UjTx1YCbuWbz636s`, READY preview, `a5245fa` |
| Production domain | `ai-productivity-assistant-eta.vercel.app` resolves to `dpl_HYZRBhdXHcvSGHxQooeU6ikk6pYQ`, READY production, `930bc19` |
| Production deployment source | `redeploy`, branch `day-12` |

Production therefore lacks the latest fix that displays status unavailable when integration-status loading fails. The metadata establishes the redeploy path; it does not establish who chose the production target or why. The returned project metadata did not expose the configured production Git branch. No release target was changed.

Evidence: [production deployment](https://vercel.com/dev-a81c/ai-productivity-assistant/HYZRBhdXHcvSGHxQooeU6ikk6pYQ), [latest preview](https://vercel.com/dev-a81c/ai-productivity-assistant/6vPu8eGqdjK8UjTx1YCbuWbz636s).

## Verification

- Local: 30 test files / 278 tests passed; TypeScript and ESLint passed. Initial sandboxed Vitest execution failed with Windows EPERM; the authorized rerun outside the sandbox passed.
- GitHub: [App verification for a5245fa](https://github.com/devansh9-design/ai-productivity-assistant/actions/runs/38798394943) passed, including tests, typecheck, lint, and production build. A local production build was not repeated.
- GitHub: [clean migration and database behavior checks](https://github.com/devansh9-design/ai-productivity-assistant/actions/runs/38788807115) passed for `3437080`, which introduced the Day 12 migration. Later commits changed application behavior.
- These checks do not establish that authenticated browser flows, real Google publishing, or cross-account live RLS regression tests passed.

## Live Supabase

Project `ctjfbhnpmpjepupomtrt` is ACTIVE_HEALTHY. Migration history contains `20261015120000_weekly_reviews` and `20261016120000_integration_status`. The integration-status table exists with RLS and four ownership policies. All 25 inspected public base tables have RLS enabled.

The inspected calendar status has planning/publishing enabled, no reconnect flag, a successful read timestamp, no recorded error, and no last-published timestamp. The production Settings card also displayed Connected, last read at October 16 01:07 IST, Last published Never, and Last problem None. This is evidence of status rendering and a recorded read, not proof that every Calendar flow works.

Security observations to close in Day 13:

1. Live `google_credentials` grants include TRUNCATE, TRIGGER, and REFERENCES for both anon and authenticated. SELECT/INSERT/UPDATE/DELETE are absent for those roles. Review/revoke unnecessary grants; RLS alone does not cover every table-level operation. No destructive privilege test was attempted, and a public HTTP exploit was not established. Other inspected core tables also have broad authenticated grants.
2. The advisor flags mutable search paths on `set_telegram_chat_mappings_updated_at` and `set_ai_conversations_updated_at`. Both are security-invoker functions and have anon/authenticated EXECUTE privileges. Review and harden their intended trigger-only use. [Advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable).
3. Leaked-password protection is disabled. [Auth guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
4. The advisor's three no-policy notices concern the Google credentials/calendar/event mapping tables, whose server-only design deliberately denies ordinary row access. Do not add broad client policies merely to silence these notices. [Advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
5. Performance advisor: eight unindexed foreign keys, seven per-row auth-policy evaluation warnings, and nineteen unused-index notices. Assess workload before changing indexes; these are not evidence of a current outage.
6. Live migration history includes dashboard-era entries absent from repository history, while early repository migrations are not recorded there. Clean-database CI is useful but does not prove live/repository schema parity. Reconcile schema and history during the audit rather than replaying all migrations blindly.

Source inspection confirms a server-only service-role helper and user-scoped Calendar operations. It does not constitute a complete credential-exposure or Git-history audit. The README still says not to use a service-role key, which is stale relative to the implemented server-only integration.

## Day 10 and Day 11 records

`Timer precedence test` still exists and is completed. Its four closed sessions total **20 minutes** (2 + 14 + 2 + 2); `actual_minutes` is 5. The analytics implementation should count the 20 timer minutes and exclude the 5 manual minutes for that task.

The signed-in production Analytics page showed “Analytics could not be loaded right now. Please refresh to try again.” Vercel recorded `Analytics load failed: JWT issued at future` at 2026-10-16 09:11:22 UTC (14:41:22 IST), on the production deployment. Investigate token timing/refresh and clock agreement, then repeat the UI comparison. The precise cause and persistence of this error remain unconfirmed. Do not mark the timer UI check passed.

Follow-up on October 16: the signed-in production `/analytics?range=week` page subsequently loaded successfully. It displayed Logged time **20m**, **Timer 20m · entered on completion 0m**, Thursday October 15 logged **20m**, and DSA category **20m**. This closes the existing timer-precedence display comparison. The test record is retained; cleanup is a separate action. The earlier failure remains valid evidence of an intermittent reliability problem.

Investigation: the Vercel log query found the single recorded JWT error in the inspected 30-minute window. Supabase Auth logs around that period include successful `/user` requests. A direct database clock read returned the current UTC time, but neither that observation nor these logs measures the failing token's issue time against the actual PostgREST validator clock. No raw tokens were collected. Upstream reports describe similar timing failures; they do not prove this project's root cause: [PostgREST issue 5172](https://github.com/PostgREST/postgrest/issues/5172), [Supabase discussion 48123](https://github.com/orgs/supabase/discussions/48123).

Local mitigation: `lib/analytics/read-page.ts` rebuilds the same user-scoped Analytics SELECT after exactly `PGRST303` / `JWT issued at future`, waiting 1 second then 2 seconds, with a maximum of three attempts. Other errors return immediately. Persistent timing errors still reach the page's existing failure state. Logs record retry/recovery/exhaustion without credentials or record content. There is no token refresh, JWT validation change, service-role fallback, or write retry. Nine new regression cases cover recovery, exhausted retries, and errors that must not retry. All 287 tests, TypeScript, ESLint, and the local production build passed. This mitigates short transient failures; it does not repair managed infrastructure or establish that the incident is permanently resolved.

The retries apply to Analytics loading, including its read helper reused by weekly facts; they do not cover every Supabase request elsewhere in the application. The patch has not been deployed, so live recovery occurred independently of the patch.

The six weekly test tasks all exist. A saved plan exists for October 19, 2026:

- Priorities, in order: TEST P1, TEST P2, TEST P6 new.
- Shortlist, in order: TEST P3, TEST P4, TEST P5.

This confirms persisted selections. The actual Monday Today display and status-update checks remain pending. No test records were deleted.

## Scope and unfinished work

The roadmap remains the original plan and still describes Telegram/n8n and notification release criteria. Current source has Telegram migrations and legacy references, but no current Telegram route handlers or n8n workflow files were found in the inspected app. Distinguish existing database groundwork from a delivered automation feature. Treat the user's revised scope as deferring delivery, commands, schedules, quiet hours, and GitHub activity import.

Day 13 is partly supported by existing authorization, RLS, proposal validation, publication locks, recovery logic, and tests. Application rate limiting and a user-data JSON export endpoint were not found. Logging currently uses console errors; managed monitoring and platform-side firewall/rate-limit configuration were not comprehensively audited. The AI implementation uses Gemini, while the original architecture describes OpenAI.

Still required before release sign-off:

- Analytics timer display comparison passed on follow-up. Validate the local retry mitigation on a release candidate; investigate/escalate persistent JWT timing failures before calling authentication reliability resolved.
- Finish Day 12 interactive checks on the intended candidate: planning pause, publishing pause, stale tabs, reconnect/revocation/disconnect, connected/disconnected AI proposals, safe Calendar publishing and retry behavior, Settings at phone width.
- Complete busy-week summary, weekly persistence/editing and mobile QA; perform the October 19 Today/status test before cleaning up weekly test records.
- Resolve the intended production commit and Git release workflow; then release the verified candidate through an explicitly authorized release action.
- Complete Day 13 authorization/RLS/credential audit, rate limiting, monitoring, JSON backup/export, and full end-to-end QA.
- Update the roadmap/README to reflect the actual release scope and setup.

Telegram/n8n, GitHub activity import, scheduled delivery/quiet hours, and the post-beta backlog remain deferred. No deployments, migrations, account/security settings, calendar writes, or test-data deletions were performed during this inspection.

## Follow-up security and migration inventory

All 25 table names declared in repository migrations exist live. This inventory comparison is not a complete comparison of columns, constraints, policy expressions, function bodies, indexes, or default privileges.

The public routine inventory contains four SECURITY DEFINER functions: `handle_new_user`, `rls_auto_enable`, `telegram_checkin`, and `telegram_today`. None grants EXECUTE to anon or authenticated. The publication RPCs and weekly save RPCs also deny anon execution. No public views were found. A limited policy-expression scan found no literal `true` or `user_metadata` authorization expressions; full policy-by-policy and cross-account tests remain necessary.

Repository migration history has 30 files; live history has 29 versions. Eleven repository migrations from July 30 through August 6 are absent from live recorded history, although their table names are present. The repository's `20260914180000_add_telegram_task_status` is also absent. Eleven live history entries have no same-version repository file, including historical Google mappings, Telegram check-in RPC, AI/revert, and privilege changes. Do not treat missing history as proof that the corresponding schema work never occurred.

Three live function names have no CREATE definition in the repository migration inventory: `rls_auto_enable` (already acknowledged as dashboard-only by a repository migration), `set_google_planner_calendars_updated_at`, and `telegram_checkin`. The remaining repository function names are present live. Function-name agreement does not establish body agreement, particularly for `telegram_today` given the missing task-status migration.

Safe reconciliation remains open: produce disposable clean-database and live schema-only snapshots; compare definitions and grants, account for intentional Supabase-managed objects, then prepare narrowly scoped forward migrations and justified history repairs. No migration replay, history repair, or production DDL was performed.

Security follow-ups remain open: least-privilege migration, the two trigger search paths, application rate limiting, JSON backup/export, logging review, full authorization testing, and a decision about enabling leaked-password protection. This investigation does not mark Day 13 complete.

## October 19 — status action and cleanup gate

The task action form had no UI action for `in_progress`; Start timer only started a session. The earlier manual instruction to switch a task to In progress therefore could not be followed through that form.

A local change adds **Start task** for `todo` and `deferred` tasks in the shared task action form used by Today and Tasks. It submits `in_progress` through the existing authenticated, user-scoped status Server Action and disables competing status controls while saving. Completed tasks must first be reopened. Timer behavior is unchanged. This UI change is not deployed and its signed-in browser persistence check is still pending.

Cleanup remains on hold. Use TEST P2 (reported as todo) for Start task, refresh Today and Tasks, and verify the persisted In progress status and the weekly priorities card. TEST P1 was reported completed by the user; this report does not claim a fresh database check of those statuses. Only after both UI checks pass should the six weekly test tasks be deleted through Tasks. Keep Timer precedence test untouched. No task mutations or deletions were performed for this local code change.
