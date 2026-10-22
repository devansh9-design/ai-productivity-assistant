import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { requireUser } from "@/lib/auth/require-user";
import { loadOnboardingState } from "@/lib/onboarding/load";
import { defaultWeek, weekFromRules } from "@/lib/onboarding/wizard";

export const metadata: Metadata = { title: "Set up your planner" };

/**
 * First-run setup for a new student, and the place Settings sends a student
 * to change their profile or timetable (?edit=1). A student who has finished
 * onboarding is sent to Today unless they asked to edit.
 */
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase, user } = await requireUser();
  const editing = (await searchParams).edit === "1";
  const { profile, rules } = await loadOnboardingState(supabase, user.id);
  if (profile?.onboarded_at && !editing) redirect("/today");

  const savedWeek = rules.length ? weekFromRules(rules) : defaultWeek();
  const nameFromEmail = (user.email ?? "").split("@")[0].replace(/[._-]+/g, " ").trim();

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 sm:py-12">
      <div className="mx-auto mb-6 w-full max-w-2xl">
        <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">{editing ? "Settings" : "Welcome"}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          {editing ? "Your profile and week" : "Let's set up your planner"}
        </h1>
        {!editing && <p className="mt-2 text-sm text-slate-600">Three quick steps, about 3 minutes. You can change everything later in Settings.</p>}
      </div>
      <OnboardingWizard
        editing={editing}
        initialName={profile?.display_name ?? nameFromEmail}
        initialYear={profile?.college_year ? String(profile.college_year) : ""}
        initialTimeZone={profile?.timezone ?? ""}
        initialWeek={savedWeek}
      />
    </div>
  );
}
