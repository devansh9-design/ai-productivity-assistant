"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { completeOnboarding } from "@/lib/onboarding/actions";
import {
  GOAL_CATEGORIES, GOAL_TEMPLATES, MAX_CLASSES_PER_DAY, MAX_GOALS, WIZARD_DAYS, parseOnboarding,
  type OnboardingInput, type WizardDay, type WizardGoal,
} from "@/lib/onboarding/wizard";
import { getTodayISODate } from "@/lib/tasks/timezone";

const STEPS = ["About you", "Your week", "Your goals"] as const;

interface Props {
  /** True when re-running from Settings: goals become optional extras. */
  editing: boolean;
  initialName: string;
  initialYear: string;
  initialTimeZone: string;
  initialWeek: WizardDay[];
}

function browserTimeZone(fallback: string): string {
  try {
    return fallback || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return fallback || "UTC";
  }
}

function timeZones(current: string): string[] {
  try {
    const all = Intl.supportedValuesOf("timeZone");
    return all.includes(current) ? all : [current, ...all];
  } catch {
    return [current];
  }
}

export function OnboardingWizard({ editing, initialName, initialYear, initialTimeZone, initialWeek }: Props) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [displayName, setDisplayName] = useState(initialName);
  const [collegeYear, setCollegeYear] = useState(initialYear);
  const [timeZone, setTimeZone] = useState(() => browserTimeZone(initialTimeZone));
  const [week, setWeek] = useState<WizardDay[]>(initialWeek);
  const [goals, setGoals] = useState<WizardGoal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const zones = useMemo(() => timeZones(timeZone), [timeZone]);

  const input = (overrides: Partial<OnboardingInput> = {}): OnboardingInput =>
    ({ displayName, collegeYear, timeZone, saveWeek: true, week, goals, ...overrides });
  const check = (overrides: Partial<OnboardingInput>) => {
    const result = parseOnboarding(input(overrides), getTodayISODate(timeZone));
    return result.ok ? null : result.error;
  };

  function next() {
    // Each step is checked on its own: the profile first, then the week.
    const problem = step === 0 ? check({ saveWeek: false, goals: [] }) : check({ goals: [] });
    setError(problem);
    if (!problem) setStep(step + 1);
  }

  function finish() {
    const problem = check({});
    setError(problem);
    if (problem) return;
    startSaving(async () => {
      const result = await completeOnboarding(input());
      if ("error" in result) { setError(result.error); return; }
      router.replace("/today");
      router.refresh();
    });
  }

  const updateDay = (weekday: number, change: (day: WizardDay) => WizardDay) =>
    setWeek((days) => days.map((day) => (day.weekday === weekday ? change(day) : day)));

  function copyMondayToWeekdays() {
    const monday = week.find((day) => day.weekday === 1);
    if (!monday) return;
    setWeek((days) => days.map((day) => (day.weekday >= 2 && day.weekday <= 5
      ? { ...day, classes: monday.classes.map((slot) => ({ ...slot })), study: monday.study ? { ...monday.study } : null }
      : day)));
  }

  const updateGoal = (index: number, change: Partial<WizardGoal>) =>
    setGoals((list) => list.map((goal, i) => (i === index ? { ...goal, ...change } : goal)));

  return (
    <div className="mx-auto w-full max-w-2xl">
      <ol className="mb-6 grid grid-cols-3 gap-2" aria-label="Setup steps">
        {STEPS.map((label, index) => (
          <li key={label} aria-current={index === step ? "step" : undefined}
            className={`rounded-lg px-2 py-2 text-center text-xs font-semibold sm:text-sm ${index === step
              ? "bg-indigo-600 text-white" : index < step ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-500"}`}>
            <span className="inline-flex items-center gap-1">{index < step && <Check aria-hidden="true" className="h-3.5 w-3.5" />}{label}</span>
          </li>
        ))}
      </ol>

      <div className="card p-5 sm:p-6">
        {step === 0 && (
          <section aria-labelledby="about-title">
            <h2 id="about-title" className="text-xl font-bold text-slate-900">About you</h2>
            <p className="mt-1 text-sm text-slate-600">Used to plan around your days and to word the AI&apos;s suggestions.</p>
            <label className="mt-5 block text-sm font-medium text-slate-700">Your name
              <input className="input mt-1" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={80} autoComplete="given-name" />
            </label>
            <label className="mt-4 block text-sm font-medium text-slate-700">Year of college
              <select className="input mt-1" value={collegeYear} onChange={(event) => setCollegeYear(event.target.value)}>
                <option value="">Choose…</option>
                {[1, 2, 3, 4, 5, 6].map((year) => <option key={year} value={String(year)}>{["1st", "2nd", "3rd", "4th", "5th", "6th"][year - 1]} year</option>)}
              </select>
            </label>
            <label className="mt-4 block text-sm font-medium text-slate-700">Timezone
              <select className="input mt-1" value={timeZone} onChange={(event) => setTimeZone(event.target.value)}>
                {zones.map((zone) => <option key={zone} value={zone}>{zone.replaceAll("_", " ")}</option>)}
              </select>
              <span className="mt-1 block text-xs text-slate-500">Detected from this device; change it if it&apos;s wrong.</span>
            </label>
          </section>
        )}

        {step === 1 && (
          <section aria-labelledby="week-title">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 id="week-title" className="text-xl font-bold text-slate-900">Your week</h2>
                <p className="mt-1 text-sm text-slate-600">Add your classes, and when you&apos;re free to work on goals. Plans never go into class time.</p>
              </div>
              <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={copyMondayToWeekdays}>
                <Copy aria-hidden="true" className="h-3.5 w-3.5" />Copy Monday to Tue–Fri
              </button>
            </div>
            <div className="mt-5 space-y-3">
              {WIZARD_DAYS.map(({ weekday, label }) => {
                const day = week.find((entry) => entry.weekday === weekday) ?? { weekday, classes: [], study: null };
                return (
                  <fieldset key={weekday} className="min-w-0 rounded-xl border border-slate-200 p-3">
                    <legend className="px-1 text-sm font-semibold text-slate-900">{label}</legend>
                    <div className="space-y-2">
                      {day.classes.map((slot, index) => (
                        <div key={index} className="flex items-center gap-2 text-sm">
                          <span className="w-12 shrink-0 text-xs font-medium text-slate-500">Class</span>
                          <input type="time" aria-label={`${label} class ${index + 1} start`} className="input min-w-0 px-2 py-1.5" value={slot.start}
                            onChange={(event) => updateDay(weekday, (d) => ({ ...d, classes: d.classes.map((s, i) => (i === index ? { ...s, start: event.target.value } : s)) }))} />
                          <span className="text-slate-400">–</span>
                          <input type="time" aria-label={`${label} class ${index + 1} end`} className="input min-w-0 px-2 py-1.5" value={slot.end}
                            onChange={(event) => updateDay(weekday, (d) => ({ ...d, classes: d.classes.map((s, i) => (i === index ? { ...s, end: event.target.value } : s)) }))} />
                          <button type="button" aria-label={`Remove ${label} class ${index + 1}`} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                            onClick={() => updateDay(weekday, (d) => ({ ...d, classes: d.classes.filter((_, i) => i !== index) }))}>
                            <Trash2 aria-hidden="true" className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                      {day.study && (
                        <div className="flex items-center gap-2 text-sm">
                          <span className="w-12 shrink-0 text-xs font-medium text-emerald-700">Study</span>
                          <input type="time" aria-label={`${label} study start`} className="input min-w-0 px-2 py-1.5" value={day.study.start}
                            onChange={(event) => updateDay(weekday, (d) => ({ ...d, study: d.study && { ...d.study, start: event.target.value } }))} />
                          <span className="text-slate-400">–</span>
                          <input type="time" aria-label={`${label} study end`} className="input min-w-0 px-2 py-1.5" value={day.study.end}
                            onChange={(event) => updateDay(weekday, (d) => ({ ...d, study: d.study && { ...d.study, end: event.target.value } }))} />
                          <button type="button" aria-label={`Remove ${label} study time`} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                            onClick={() => updateDay(weekday, (d) => ({ ...d, study: null }))}>
                            <Trash2 aria-hidden="true" className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2 pt-1">
                        {day.classes.length < MAX_CLASSES_PER_DAY && (
                          <button type="button" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-50"
                            onClick={() => updateDay(weekday, (d) => ({ ...d, classes: [...d.classes, { start: "09:00", end: "10:00" }] }))}>
                            <Plus aria-hidden="true" className="h-3.5 w-3.5" />Class
                          </button>
                        )}
                        {!day.study && (
                          <button type="button" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                            onClick={() => updateDay(weekday, (d) => ({ ...d, study: { start: "18:00", end: "21:00" } }))}>
                            <Plus aria-hidden="true" className="h-3.5 w-3.5" />Study time
                          </button>
                        )}
                      </div>
                    </div>
                  </fieldset>
                );
              })}
            </div>
          </section>
        )}

        {step === 2 && (
          <section aria-labelledby="goals-title">
            <h2 id="goals-title" className="text-xl font-bold text-slate-900">{editing ? "Add goals (optional)" : "Your goals"}</h2>
            <p className="mt-1 text-sm text-slate-600">
              What do you want to achieve? Pick a starting point or add your own. You&apos;ll build the plan for each goal next, yourself or with the AI.
            </p>
            {goals.length < MAX_GOALS && (
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                {GOAL_TEMPLATES.map((template) => (
                  <button key={template.title} type="button"
                    className="rounded-xl border border-slate-200 p-3 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50"
                    onClick={() => setGoals((list) => [...list, { title: template.title, category: template.category, targetDate: "", weeklyHours: String(template.weeklyHours) }])}>
                    <span className="block text-sm font-semibold text-slate-900">+ {template.title}</span>
                    <span className="block text-xs text-slate-500">{template.hint}</span>
                  </button>
                ))}
                <button type="button" className="rounded-xl border border-dashed border-slate-300 p-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:col-span-2"
                  onClick={() => setGoals((list) => [...list, { title: "", category: "other", targetDate: "", weeklyHours: "" }])}>
                  + Your own goal
                </button>
              </div>
            )}
            <div className="mt-5 space-y-3">
              {goals.map((goal, index) => (
                <fieldset key={index} className="min-w-0 rounded-xl border border-slate-200 p-3">
                  <legend className="sr-only">Goal {index + 1}</legend>
                  <div className="flex items-start gap-2">
                    <label className="flex-1 text-xs font-medium text-slate-600">Goal
                      <input className="input mt-1 text-sm" value={goal.title} maxLength={200} placeholder="e.g. Put on 5 kg of muscle"
                        onChange={(event) => updateGoal(index, { title: event.target.value })} />
                    </label>
                    <button type="button" aria-label={`Remove goal ${index + 1}`} className="mt-5 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                      onClick={() => setGoals((list) => list.filter((_, i) => i !== index))}>
                      <Trash2 aria-hidden="true" className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <label className="text-xs font-medium text-slate-600">Type
                      <select className="input mt-1 text-sm" value={goal.category} onChange={(event) => updateGoal(index, { category: event.target.value as WizardGoal["category"] })}>
                        {GOAL_CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
                      </select>
                    </label>
                    <label className="text-xs font-medium text-slate-600">Target date
                      <input type="date" className="input mt-1 text-sm" value={goal.targetDate} min={getTodayISODate(timeZone)}
                        onChange={(event) => updateGoal(index, { targetDate: event.target.value })} />
                    </label>
                    <label className="text-xs font-medium text-slate-600">Hours per week
                      <input type="number" inputMode="decimal" min={0.5} max={112} step={0.5} className="input mt-1 text-sm" value={goal.weeklyHours}
                        onChange={(event) => updateGoal(index, { weeklyHours: event.target.value })} />
                    </label>
                  </div>
                </fieldset>
              ))}
              {!goals.length && <p className="text-sm text-slate-500">No goals yet. You can also skip this and add them later.</p>}
            </div>
          </section>
        )}

        {error && <p role="alert" className="mt-5 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}

        <div className="mt-6 flex items-center justify-between gap-3 border-t border-slate-200 pt-4">
          <button type="button" className="btn-secondary" onClick={() => { setError(null); setStep(step - 1); }} disabled={step === 0 || saving}>Back</button>
          {step < STEPS.length - 1
            ? <button type="button" className="btn-primary" onClick={next}>Next</button>
            : (
              <button type="button" className="btn-primary" onClick={finish} disabled={saving}>
                {saving && <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />}
                {saving ? "Saving…" : goals.length || editing ? "Finish" : "Skip goals and finish"}
              </button>
            )}
        </div>
      </div>
    </div>
  );
}
