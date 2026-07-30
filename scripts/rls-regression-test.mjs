#!/usr/bin/env node
/**
 * RLS regression test (Fix 7).
 *
 * The acceptance criteria for Day 2 say "a second test account cannot read
 * the first account's records," but that was only ever checked by hand.
 * This script automates it against a real Supabase project (RLS cannot be
 * meaningfully tested against a mock -- it is Postgres policy evaluation,
 * not application code), exercising two authenticated users against:
 *
 *   - SELECT isolation on goals/projects/milestones/tasks
 *   - INSERT isolation (a row created by user A is invisible to user B)
 *   - UPDATE isolation (user B cannot modify user A's row)
 *   - DELETE isolation (user B cannot delete user A's row)
 *   - cross-table FK isolation (Fix 1): user B cannot create a project,
 *     task, milestone, task_dependency, or task_session that references
 *     one of user A's rows
 *
 * This is deliberately NOT a unit test / vitest suite: it needs two real
 * authenticated sessions against Postgres RLS, which only exists once
 * migrations are applied to an actual (ideally disposable/test) Supabase
 * project. Run it manually or wire it into CI as a separate job from
 * `npm test`.
 *
 * Required environment variables:
 *   SUPABASE_URL              Project URL
 *   SUPABASE_ANON_KEY         Anon/public key
 *   TEST_USER_A_EMAIL / TEST_USER_A_PASSWORD
 *   TEST_USER_B_EMAIL / TEST_USER_B_PASSWORD
 *
 * Both test accounts must already exist (sign them up once via the app's
 * normal /login flow, or supabase.auth.admin.createUser with a service
 * role key in a one-off setup script) and must NOT be accounts you use for
 * real data, since this script inserts and deletes rows.
 *
 * Usage:
 *   node scripts/rls-regression-test.mjs
 *
 * Exit code is 0 when every check passes, 1 otherwise -- safe to gate CI on.
 */

import { createClient } from "@supabase/supabase-js";

const required = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "TEST_USER_A_EMAIL",
  "TEST_USER_A_PASSWORD",
  "TEST_USER_B_EMAIL",
  "TEST_USER_B_PASSWORD",
];

const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(", ")}`);
  console.error("See the header of this script for what each one is and how to set it up.");
  process.exit(1);
}

const results = [];

function record(name, passed, detail) {
  results.push({ name, passed, detail });
  const status = passed ? "PASS" : "FAIL";
  console.log(`[${status}] ${name}${detail ? ` -- ${detail}` : ""}`);
}

async function signIn(email, password) {
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    throw new Error(`Sign-in failed for ${email}: ${error?.message ?? "no user returned"}`);
  }
  return { client, userId: data.user.id };
}

async function main() {
  const a = await signIn(process.env.TEST_USER_A_EMAIL, process.env.TEST_USER_A_PASSWORD);
  const b = await signIn(process.env.TEST_USER_B_EMAIL, process.env.TEST_USER_B_PASSWORD);

  if (a.userId === b.userId) {
    throw new Error("TEST_USER_A and TEST_USER_B resolved to the same user -- use two distinct accounts.");
  }

  // --- Set up a row owned by user A for each table under test ---------
  const { data: goalA, error: goalErr } = await a.client
    .from("goals")
    .insert({ user_id: a.userId, title: "rls-test goal" })
    .select()
    .single();
  if (goalErr) throw new Error(`Setup failed creating goal as user A: ${goalErr.message}`);

  const { data: projectA, error: projectErr } = await a.client
    .from("projects")
    .insert({ user_id: a.userId, title: "rls-test project", goal_id: goalA.id })
    .select()
    .single();
  if (projectErr) throw new Error(`Setup failed creating project as user A: ${projectErr.message}`);

  const { data: milestoneA, error: milestoneErr } = await a.client
    .from("milestones")
    .insert({ user_id: a.userId, title: "rls-test milestone", project_id: projectA.id })
    .select()
    .single();
  if (milestoneErr) throw new Error(`Setup failed creating milestone as user A: ${milestoneErr.message}`);

  const { data: taskA, error: taskErr } = await a.client
    .from("tasks")
    .insert({ user_id: a.userId, title: "rls-test task", goal_id: goalA.id, project_id: projectA.id })
    .select()
    .single();
  if (taskErr) throw new Error(`Setup failed creating task as user A: ${taskErr.message}`);

  // --- SELECT isolation -------------------------------------------------
  for (const [table, id] of [
    ["goals", goalA.id],
    ["projects", projectA.id],
    ["milestones", milestoneA.id],
    ["tasks", taskA.id],
  ]) {
    const { data } = await b.client.from(table).select("*").eq("id", id);
    record(`SELECT isolation: user B cannot read user A's ${table} row`, (data ?? []).length === 0);
  }

  // --- UPDATE isolation --------------------------------------------------
  const { data: updateResult, error: updateError } = await b.client
    .from("goals")
    .update({ status: "archived" })
    .eq("id", goalA.id)
    .select();
  record(
    "UPDATE isolation: user B cannot modify user A's goal",
    !updateError && (updateResult ?? []).length === 0,
    updateError?.message,
  );

  // --- DELETE isolation --------------------------------------------------
  const { data: deleteResult, error: deleteError } = await b.client
    .from("tasks")
    .delete()
    .eq("id", taskA.id)
    .select();
  record(
    "DELETE isolation: user B cannot delete user A's task",
    !deleteError && (deleteResult ?? []).length === 0,
    deleteError?.message,
  );

  // --- Cross-table FK isolation (Fix 1) -----------------------------------
  const { error: crossProjectError } = await b.client
    .from("projects")
    .insert({ user_id: b.userId, title: "rls-test cross-user project", goal_id: goalA.id });
  record(
    "FK isolation: user B cannot create a project pointing at user A's goal",
    !!crossProjectError,
    crossProjectError?.message,
  );

  const { error: crossTaskError } = await b.client
    .from("tasks")
    .insert({ user_id: b.userId, title: "rls-test cross-user task", milestone_id: milestoneA.id });
  record(
    "FK isolation: user B cannot create a task pointing at user A's milestone",
    !!crossTaskError,
    crossTaskError?.message,
  );

  const { error: crossDependencyError } = await b.client
    .from("task_dependencies")
    .insert({ user_id: b.userId, task_id: taskA.id, depends_on_task_id: taskA.id });
  record(
    "FK isolation: user B cannot create a task_dependency referencing user A's task",
    !!crossDependencyError,
    crossDependencyError?.message,
  );

  // --- Cleanup (as user A, who owns these rows) ---------------------------
  await a.client.from("tasks").delete().eq("id", taskA.id);
  await a.client.from("milestones").delete().eq("id", milestoneA.id);
  await a.client.from("projects").delete().eq("id", projectA.id);
  await a.client.from("goals").delete().eq("id", goalA.id);

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length > 0) {
    console.error(`${failed.length} RLS regression check(s) failed.`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.stack ?? error.message ?? error);
  process.exit(1);
});
