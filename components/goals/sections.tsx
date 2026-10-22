import type { ReactNode } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { ActionSubmitButton } from "@/components/action-submit-button";
import {
  deleteMetric, deletePhase, deleteRoutine, deleteWeeklyTarget, saveMetric, savePhase, saveRoutine, saveWeeklyTarget, setRoutineActive,
} from "@/lib/goals/actions";
import { daysBetween, formatMinutes, ISO_DAYS, mondayOf, weeklyMinutes } from "@/lib/goals/roadmap";
import type { MetricProgress } from "@/lib/evening/log";
import type { Goal, GoalMetric, GoalPhase, Routine, WeeklyTarget } from "@/lib/types";

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function shortDate(value: string) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function amount(value: number | null, unit: string | null) {
  if (value === null) return "–";
  return `${Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ""}`;
}

export function Section({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="card p-5 sm:p-6">
      <h2 id={id} className="text-lg font-semibold text-slate-900">{title}</h2>
      <p className="mt-1 text-sm text-slate-600">{description}</p>
      {children}
    </section>
  );
}

function AddForm({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="group mt-4 rounded-xl border border-dashed border-slate-300">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-indigo-600">
        <Plus aria-hidden="true" className="h-4 w-4 transition-transform group-open:rotate-45" />{label}
      </summary>
      <div className="border-t border-slate-200 p-4">{children}</div>
    </details>
  );
}

/** A row with its own Edit (inline form) and Delete controls. */
function ItemRow({ children, editForm, deleteAction, hidden, deleteLabel }: {
  children: ReactNode;
  editForm: ReactNode;
  deleteAction: (formData: FormData) => Promise<unknown>;
  hidden: Record<string, string>;
  deleteLabel: string;
}) {
  return (
    <li className="rounded-xl border border-slate-200 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">{children}</div>
        <ActionForm action={deleteAction} resetOnSuccess={false} className="shrink-0">
          {Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
          <ActionSubmitButton pendingLabel="…" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-rose-600" aria-label={deleteLabel}>
            <Trash2 aria-hidden="true" className="h-4 w-4" />
          </ActionSubmitButton>
        </ActionForm>
      </div>
      <details className="group mt-1">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded px-1 text-xs font-semibold text-indigo-600 hover:underline">
          <Pencil aria-hidden="true" className="h-3 w-3" />Edit
        </summary>
        <div className="mt-3 border-t border-slate-200 pt-3">{editForm}</div>
      </details>
    </li>
  );
}

const fieldClass = "block text-xs font-medium text-slate-600";

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

function MetricFields({ metric }: { metric?: GoalMetric }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className={fieldClass}>What to track
        <input className="input mt-1 text-sm" name="name" required maxLength={80} defaultValue={metric?.name} placeholder="e.g. Body weight, Problems solved" />
      </label>
      <label className={fieldClass}>Unit
        <input className="input mt-1 text-sm" name="unit" maxLength={20} defaultValue={metric?.unit ?? ""} placeholder="kg, problems, hours" />
      </label>
      <label className={fieldClass}>How it adds up
        <select className="input mt-1 text-sm" name="aggregation" defaultValue={metric?.aggregation ?? "sum"}>
          <option value="sum">Add up each day&apos;s amount (problems, hours, sessions)</option>
          <option value="latest">Latest reading (body weight, test score)</option>
        </select>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className={fieldClass}>Starting value
          <input type="number" step="any" className="input mt-1 text-sm" name="baseline_value" defaultValue={metric?.baseline_value ?? ""} />
        </label>
        <label className={fieldClass}>Target
          <input type="number" step="any" className="input mt-1 text-sm" name="target_value" defaultValue={metric?.target_value ?? ""} />
        </label>
      </div>
    </div>
  );
}

export function MetricsSection({ goal, metrics, progress }: { goal: Goal; metrics: GoalMetric[]; progress: Record<string, MetricProgress> }) {
  return (
    <Section id="metrics-title" title="Metrics" description="The numbers that show progress. You'll log them in the evening, and they feed the progress charts.">
      {metrics.length > 0 && (
        <ul className="mt-4 space-y-2">
          {metrics.map((metric) => (
            <ItemRow key={metric.id} deleteAction={deleteMetric} hidden={{ id: metric.id, goal_id: goal.id }} deleteLabel={`Delete metric ${metric.name}`}
              editForm={(
                <ActionForm action={saveMetric} resetOnSuccess={false}>
                  <input type="hidden" name="id" value={metric.id} /><input type="hidden" name="goal_id" value={goal.id} />
                  <MetricFields metric={metric} />
                  <ActionSubmitButton pendingLabel="Saving…" className="mt-3 btn-primary">Save metric</ActionSubmitButton>
                </ActionForm>
              )}>
              <p className="text-sm font-semibold text-slate-900">{metric.name}</p>
              <p className="text-xs text-slate-500">
                {amount(metric.baseline_value, metric.unit)} → {amount(metric.target_value, metric.unit)} · {metric.aggregation === "sum" ? "adds up daily amounts" : "uses the latest reading"}
              </p>
              <MetricProgressLine metric={metric} progress={progress[metric.id]} />
            </ItemRow>
          ))}
        </ul>
      )}
      <AddForm label="Add a metric">
        <ActionForm action={saveMetric}>
          <input type="hidden" name="goal_id" value={goal.id} />
          <MetricFields />
          <ActionSubmitButton pendingLabel="Adding…" className="mt-3 btn-primary">Add metric</ActionSubmitButton>
        </ActionForm>
      </AddForm>
    </Section>
  );
}

/** Where the metric stands now, from the evening log. */
function MetricProgressLine({ metric, progress }: { metric: GoalMetric; progress: MetricProgress | undefined }) {
  if (!progress?.lastLoggedOn) return <p className="mt-1 text-xs text-slate-500">Nothing logged yet. Add today&apos;s number in the evening log.</p>;
  return (
    <div className="mt-1">
      <p className="text-xs font-medium text-slate-800">
        Now {amount(progress.current, metric.unit)}
        {progress.percent !== null && ` · ${progress.percent}% of the way`} · last logged {shortDate(progress.lastLoggedOn)}
      </p>
      {progress.percent !== null && (
        <div className="mt-1 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-slate-100" role="progressbar"
          aria-label={`${metric.name} progress`} aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${progress.percent}%` }} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Roadmap phases
// ---------------------------------------------------------------------------

const PHASE_COLORS = ["bg-indigo-500", "bg-emerald-500", "bg-amber-500", "bg-sky-500", "bg-rose-500", "bg-violet-500"];

/** A bar across the goal's span: one segment per phase, plus a marker for today. */
function RoadmapTimeline({ goal, phases, today }: { goal: Goal; phases: GoalPhase[]; today: string }) {
  const start = goal.start_date ?? phases[0]?.start_date;
  const end = goal.target_date ?? phases.at(-1)?.end_date;
  if (!start || !end || end < start || !phases.length) return null;
  const span = daysBetween(start, end);
  const offset = (date: string) => Math.min(100, Math.max(0, ((daysBetween(start, date) - 1) / span) * 100));
  const showToday = today >= start && today <= end;
  return (
    <div className="mt-4" aria-hidden="true">
      <div className="relative h-3 overflow-hidden rounded-full bg-slate-100">
        {phases.map((phase, index) => (
          <div key={phase.id} className={`absolute inset-y-0 ${PHASE_COLORS[index % PHASE_COLORS.length]} opacity-80`}
            style={{ left: `${offset(phase.start_date)}%`, width: `${Math.max(1, offset(phase.end_date) - offset(phase.start_date) + 100 / span)}%` }} />
        ))}
        {showToday && <div className="absolute inset-y-0 w-0.5 bg-slate-900" style={{ left: `${offset(today)}%` }} />}
      </div>
      <div className="relative mt-1 h-4 text-[11px] text-slate-500">
        <span className="absolute left-0">{shortDate(start)}</span>
        <span className="absolute right-0">{shortDate(end)}</span>
        {showToday && (
          // Placed under the marker, but kept clear of the start and end labels.
          <span className="absolute -translate-x-1/2 font-semibold text-slate-900" style={{ left: `${Math.min(88, Math.max(12, offset(today)))}%` }}>▲ Today</span>
        )}
      </div>
    </div>
  );
}

function PhaseFields({ phase, goal }: { phase?: GoalPhase; goal: Goal }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className={`${fieldClass} sm:col-span-2`}>Phase
        <input className="input mt-1 text-sm" name="title" required maxLength={200} defaultValue={phase?.title} placeholder="e.g. Arrays and strings" />
      </label>
      <label className={fieldClass}>Starts
        <input type="date" className="input mt-1 text-sm" name="start_date" required defaultValue={phase?.start_date ?? ""} min={goal.start_date ?? undefined} max={goal.target_date ?? undefined} />
      </label>
      <label className={fieldClass}>Ends
        <input type="date" className="input mt-1 text-sm" name="end_date" required defaultValue={phase?.end_date ?? ""} min={goal.start_date ?? undefined} max={goal.target_date ?? undefined} />
      </label>
      <label className={`${fieldClass} sm:col-span-2`}>Focus
        <textarea className="input mt-1 text-sm" name="focus" rows={2} maxLength={1000} defaultValue={phase?.focus ?? ""} placeholder="What this phase is about" />
      </label>
      <label className={`${fieldClass} sm:col-span-2`}>By the end of this phase
        <input className="input mt-1 text-sm" name="target_note" maxLength={500} defaultValue={phase?.target_note ?? ""} placeholder="e.g. 60 problems solved, squat 60 kg" />
      </label>
    </div>
  );
}

export function RoadmapSection({ goal, phases, today }: { goal: Goal; phases: GoalPhase[]; today: string }) {
  return (
    <Section id="roadmap-title" title="Roadmap" description="Phases from start to target date, in order. Each one says what to focus on and where you should be by its end.">
      <RoadmapTimeline goal={goal} phases={phases} today={today} />
      {phases.length > 0 && (
        <ol className="mt-4 space-y-2">
          {phases.map((phase, index) => {
            const current = today >= phase.start_date && today <= phase.end_date;
            return (
              <ItemRow key={phase.id} deleteAction={deletePhase} hidden={{ id: phase.id, goal_id: goal.id }} deleteLabel={`Delete phase ${phase.title}`}
                editForm={(
                  <ActionForm action={savePhase} resetOnSuccess={false}>
                    <input type="hidden" name="id" value={phase.id} /><input type="hidden" name="goal_id" value={goal.id} />
                    <PhaseFields phase={phase} goal={goal} />
                    <ActionSubmitButton pendingLabel="Saving…" className="mt-3 btn-primary">Save phase</ActionSubmitButton>
                  </ActionForm>
                )}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-block h-2.5 w-2.5 rounded-full ${PHASE_COLORS[index % PHASE_COLORS.length]}`} aria-hidden="true" />
                  <p className="text-sm font-semibold text-slate-900">{index + 1}. {phase.title}</p>
                  {current && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">Now</span>}
                </div>
                <p className="text-xs text-slate-500">{shortDate(phase.start_date)} – {shortDate(phase.end_date)} · {Math.ceil(daysBetween(phase.start_date, phase.end_date) / 7)} weeks</p>
                {phase.focus && <p className="mt-1 text-sm text-slate-600">{phase.focus}</p>}
                {phase.target_note && <p className="mt-1 text-xs font-medium text-emerald-700">Target: {phase.target_note}</p>}
              </ItemRow>
            );
          })}
        </ol>
      )}
      <AddForm label="Add a phase">
        <ActionForm action={savePhase}>
          <input type="hidden" name="goal_id" value={goal.id} />
          <PhaseFields goal={goal} />
          <ActionSubmitButton pendingLabel="Adding…" className="mt-3 btn-primary">Add phase</ActionSubmitButton>
        </ActionForm>
      </AddForm>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Weekly targets
// ---------------------------------------------------------------------------

function TargetFields({ target, metrics, today }: { target?: WeeklyTarget; metrics: GoalMetric[]; today: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className={fieldClass}>Week (any day in it)
        <input type="date" className="input mt-1 text-sm" name="week" required defaultValue={target?.week_start ?? mondayOf(today)} />
      </label>
      <label className={fieldClass}>Target
        <input className="input mt-1 text-sm" name="title" required maxLength={200} defaultValue={target?.title} placeholder="e.g. 15 problems on trees" />
      </label>
      <label className={fieldClass}>Counts towards
        <select className="input mt-1 text-sm" name="goal_metric_id" defaultValue={target?.goal_metric_id ?? ""}>
          <option value="">No metric</option>
          {metrics.map((metric) => <option key={metric.id} value={metric.id}>{metric.name}</option>)}
        </select>
      </label>
      <label className={fieldClass}>Amount
        <input type="number" step="any" min={0} className="input mt-1 text-sm" name="target_value" defaultValue={target?.target_value ?? ""} />
      </label>
    </div>
  );
}

export function TargetsSection({ goal, targets, metrics, today }: { goal: Goal; targets: WeeklyTarget[]; metrics: GoalMetric[]; today: string }) {
  const thisWeek = mondayOf(today);
  const upcoming = targets.filter((target) => target.week_start >= thisWeek);
  const pastCount = targets.length - upcoming.length;
  const metricName = (metricId: string | null) => metrics.find((metric) => metric.id === metricId);
  return (
    <Section id="targets-title" title="Weekly targets" description="What each week should achieve. The weekly review compares these with what you logged.">
      {upcoming.length > 0 && (
        <ul className="mt-4 space-y-2">
          {upcoming.map((target) => {
            const metric = metricName(target.goal_metric_id);
            return (
              <ItemRow key={target.id} deleteAction={deleteWeeklyTarget} hidden={{ id: target.id, goal_id: goal.id }} deleteLabel={`Delete target ${target.title}`}
                editForm={(
                  <ActionForm action={saveWeeklyTarget} resetOnSuccess={false}>
                    <input type="hidden" name="id" value={target.id} /><input type="hidden" name="goal_id" value={goal.id} />
                    <TargetFields target={target} metrics={metrics} today={today} />
                    <ActionSubmitButton pendingLabel="Saving…" className="mt-3 btn-primary">Save target</ActionSubmitButton>
                  </ActionForm>
                )}>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {target.week_start === thisWeek ? "This week" : `Week of ${shortDate(target.week_start)}`}
                </p>
                <p className="text-sm font-semibold text-slate-900">{target.title}</p>
                {metric && target.target_value !== null && <p className="text-xs text-slate-500">{amount(target.target_value, metric.unit)} of {metric.name}</p>}
              </ItemRow>
            );
          })}
        </ul>
      )}
      {pastCount > 0 && <p className="mt-3 text-xs text-slate-500">{pastCount} earlier {pastCount === 1 ? "week" : "weeks"} not shown.</p>}
      <AddForm label="Add a weekly target">
        <ActionForm action={saveWeeklyTarget}>
          <input type="hidden" name="goal_id" value={goal.id} />
          <TargetFields metrics={metrics} today={today} />
          <ActionSubmitButton pendingLabel="Adding…" className="mt-3 btn-primary">Add target</ActionSubmitButton>
        </ActionForm>
      </AddForm>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Routines
// ---------------------------------------------------------------------------

function RoutineFields({ routine, metrics }: { routine?: Routine; metrics: GoalMetric[] }) {
  const days = new Set(routine?.days_of_week ?? []);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className={`${fieldClass} sm:col-span-2`}>Routine
        <input className="input mt-1 text-sm" name="title" required maxLength={200} defaultValue={routine?.title} placeholder="e.g. Gym, 2 DSA problems" />
      </label>
      <fieldset className="min-w-0 sm:col-span-2">
        <legend className={fieldClass}>Days</legend>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {ISO_DAYS.map((day) => (
            <label key={day.value} className="cursor-pointer">
              <input type="checkbox" name="days" value={day.value} defaultChecked={days.has(day.value)} className="peer sr-only" />
              <span className="inline-block rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-600 peer-checked:border-indigo-500 peer-checked:bg-indigo-50 peer-checked:text-indigo-700 peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-300">
                {day.short}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className={fieldClass}>Minutes per session
        <input type="number" min={5} max={600} step={5} className="input mt-1 text-sm" name="minutes" required defaultValue={routine?.minutes ?? 60} />
      </label>
      <label className={fieldClass}>Priority
        <select className="input mt-1 text-sm" name="priority" defaultValue={routine?.priority ?? "medium"}>
          <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
        </select>
      </label>
      <label className={fieldClass}>Preferred from (optional)
        <input type="time" className="input mt-1 text-sm" name="preferred_start" defaultValue={routine?.preferred_start?.slice(0, 5) ?? ""} />
      </label>
      <label className={fieldClass}>Preferred until (optional)
        <input type="time" className="input mt-1 text-sm" name="preferred_end" defaultValue={routine?.preferred_end?.slice(0, 5) ?? ""} />
      </label>
      <label className={fieldClass}>Each session adds to
        <select className="input mt-1 text-sm" name="goal_metric_id" defaultValue={routine?.goal_metric_id ?? ""}>
          <option value="">No metric</option>
          {metrics.map((metric) => <option key={metric.id} value={metric.id}>{metric.name}</option>)}
        </select>
      </label>
      <label className={fieldClass}>Amount per session
        <input type="number" step="any" min={0} className="input mt-1 text-sm" name="metric_amount" defaultValue={routine?.metric_amount ?? ""} placeholder="e.g. 2" />
      </label>
      <label className={fieldClass}>From
        <input type="date" className="input mt-1 text-sm" name="start_date" defaultValue={routine?.start_date ?? ""} />
      </label>
      <label className={fieldClass}>Until (defaults to the goal&apos;s target date)
        <input type="date" className="input mt-1 text-sm" name="end_date" defaultValue={routine?.end_date ?? ""} />
      </label>
      <input type="hidden" name="active" value={routine ? String(routine.active) : "true"} />
    </div>
  );
}

export function RoutinesSection({ goal, routines, metrics }: { goal: Goal; routines: Routine[]; metrics: GoalMetric[] }) {
  const used = routines.filter((routine) => routine.active).reduce((total, routine) => total + weeklyMinutes(routine), 0);
  const budget = goal.weekly_hours ? Math.round(goal.weekly_hours * 60) : null;
  return (
    <Section id="routines-title" title="Routines" description="Recurring work that turns into tasks on its days, like gym on Mon/Wed/Fri or 2 problems every weekday.">
      <div className="mt-4">
        <div className="flex justify-between text-xs text-slate-600">
          <span>{formatMinutes(used)} a week in active routines</span>
          {budget ? <span>of {formatMinutes(budget)}</span> : <span>Set the goal&apos;s hours per week to cap this</span>}
        </div>
        {budget && (
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={budget} aria-valuenow={used} aria-label="Weekly time used by routines">
            <div className={`h-full rounded-full ${used > budget ? "bg-rose-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, (used / budget) * 100)}%` }} />
          </div>
        )}
      </div>
      {routines.length > 0 && (
        <ul className="mt-4 space-y-2">
          {routines.map((routine) => {
            const metric = metrics.find((item) => item.id === routine.goal_metric_id);
            return (
              <ItemRow key={routine.id} deleteAction={deleteRoutine} hidden={{ id: routine.id, goal_id: goal.id }} deleteLabel={`Delete routine ${routine.title}`}
                editForm={(
                  <ActionForm action={saveRoutine} resetOnSuccess={false}>
                    <input type="hidden" name="id" value={routine.id} /><input type="hidden" name="goal_id" value={goal.id} />
                    <RoutineFields routine={routine} metrics={metrics} />
                    <ActionSubmitButton pendingLabel="Saving…" className="mt-3 btn-primary">Save routine</ActionSubmitButton>
                  </ActionForm>
                )}>
                <div className="flex flex-wrap items-center gap-2">
                  <p className={`text-sm font-semibold ${routine.active ? "text-slate-900" : "text-slate-400 line-through"}`}>{routine.title}</p>
                  {!routine.active && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Paused</span>}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {ISO_DAYS.map((day) => (
                    <span key={day.value} className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${routine.days_of_week.includes(day.value) ? "bg-indigo-50 text-indigo-700" : "text-slate-300"}`}>{day.short}</span>
                  ))}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {routine.minutes} min a session · {formatMinutes(weeklyMinutes(routine))} a week
                  {routine.preferred_start && ` · around ${routine.preferred_start.slice(0, 5)}`}
                  {metric && routine.metric_amount !== null && ` · +${Number(routine.metric_amount)} ${metric.unit ?? metric.name} each`}
                </p>
                <ActionForm action={setRoutineActive} resetOnSuccess={false} className="mt-2">
                  <input type="hidden" name="id" value={routine.id} /><input type="hidden" name="goal_id" value={goal.id} />
                  <input type="hidden" name="active" value={String(!routine.active)} />
                  <ActionSubmitButton pendingLabel="…" className="text-xs font-semibold text-slate-600 hover:text-slate-900 hover:underline">
                    {routine.active ? "Pause" : "Resume"}
                  </ActionSubmitButton>
                </ActionForm>
              </ItemRow>
            );
          })}
        </ul>
      )}
      <AddForm label="Add a routine">
        <ActionForm action={saveRoutine}>
          <input type="hidden" name="goal_id" value={goal.id} />
          <RoutineFields metrics={metrics} />
          <ActionSubmitButton pendingLabel="Adding…" className="mt-3 btn-primary">Add routine</ActionSubmitButton>
        </ActionForm>
      </AddForm>
    </Section>
  );
}
