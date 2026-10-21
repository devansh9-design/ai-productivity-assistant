"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Plus, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { draftRoadmap, saveRoadmap } from "@/lib/goals/ai-actions";
import { checkDraft, DRAFT_SECTIONS, type DraftSection, type DraftSettings, type RoadmapDraft } from "@/lib/goals/ai-roadmap";
import { ISO_DAYS } from "@/lib/goals/roadmap";
import type { GoalLevel, IsoWeekday, MetricAggregation } from "@/lib/types";

interface Props {
  goal: { id: string; title: string; start_date: string | null; target_date: string | null; weekly_hours: number | null; level: GoalLevel | null };
  existingMetrics: string[];
  hasRoadmap: boolean;
  today: string;
}

const SECTION_LABEL: Record<DraftSection, string> = { metrics: "Metrics", phases: "Roadmap phases", targets: "Weekly targets", routines: "Routines" };
const field = "block text-xs font-medium text-slate-600";
const small = "input mt-1 px-2 py-1.5 text-sm";

function Spinner() {
  return <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />;
}

function SectionBox({ section, included, onToggle, count, children }: { section: DraftSection; included: boolean; onToggle: () => void; count: number; children: ReactNode }) {
  return (
    <fieldset className={`min-w-0 rounded-xl border p-3 ${included ? "border-slate-200" : "border-dashed border-slate-200 opacity-60"}`}>
      <legend className="px-1">
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-900">
          <input type="checkbox" checked={included} onChange={onToggle} />{SECTION_LABEL[section]} ({count})
        </label>
      </legend>
      <div className="space-y-2">{children}</div>
    </fieldset>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-rose-600">
      <Trash2 aria-hidden="true" className="h-4 w-4" />
    </button>
  );
}

/**
 * "Build with AI": confirm the goal's frame, get a drafted roadmap, edit it,
 * optionally ask for a revision, and save the parts you want. Nothing is
 * saved before "Save roadmap".
 */
export function AIRoadmapBuilder({ goal, existingMetrics, hasRoadmap, today }: Props) {
  const router = useRouter();
  const [settings, setSettings] = useState<DraftSettings>({
    start_date: goal.start_date ?? today,
    target_date: goal.target_date ?? "",
    weekly_hours: goal.weekly_hours ?? 5,
    level: goal.level,
    constraints: "",
  });
  const [draft, setDraft] = useState<RoadmapDraft | null>(null);
  const [sections, setSections] = useState<DraftSection[]>([...DRAFT_SECTIONS]);
  const [replace, setReplace] = useState(false);
  const [request, setRequest] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<"draft" | "revise" | "save" | null>(null);
  const [, startTransition] = useTransition();

  const metricNames = [...new Set([...existingMetrics, ...(draft?.metrics.map((metric) => metric.name.trim()).filter(Boolean) ?? [])])];
  const update = (change: (current: RoadmapDraft) => RoadmapDraft) => setDraft((current) => (current ? change(current) : current));

  function requestDraft(revise: boolean) {
    setError(null);
    setNotice(null);
    setBusy(revise ? "revise" : "draft");
    startTransition(async () => {
      const result = await draftRoadmap({ goalId: goal.id, settings, revise: revise && draft ? { draft, request } : undefined });
      setBusy(null);
      if (!result.ok) { setError(result.error); return; }
      setDraft(result.draft);
      setSections([...DRAFT_SECTIONS]);
      if (revise) setRequest("");
    });
  }

  function save() {
    if (!draft) return;
    const checked = checkDraft(draft, settings, existingMetrics, today, sections);
    if (!checked.ok) { setError(checked.error); return; }
    setError(null);
    setBusy("save");
    startTransition(async () => {
      const result = await saveRoadmap({ goalId: goal.id, settings, draft: checked.draft, sections, replace });
      setBusy(null);
      if (!result.ok) { setError(result.error); return; }
      setDraft(null);
      setNotice(result.message);
      router.refresh();
    });
  }

  const toggleSection = (section: DraftSection) =>
    setSections((current) => (current.includes(section) ? current.filter((item) => item !== section) : [...current, section]));

  return (
    <section aria-labelledby="ai-builder-title" className="card overflow-hidden">
      <div className="bg-indigo-50 px-5 py-4 sm:px-6">
        <h2 id="ai-builder-title" className="inline-flex items-center gap-2 text-lg font-semibold text-slate-900">
          <Sparkles aria-hidden="true" className="h-5 w-5 text-indigo-600" />Build with AI
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          The AI drafts metrics, phases, weekly targets and routines that fit your week. You review and edit everything before it&apos;s saved.
        </p>
      </div>

      <div className="p-5 sm:p-6">
        {!draft && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={field}>Start date
              <input type="date" className={small} value={settings.start_date} onChange={(event) => setSettings({ ...settings, start_date: event.target.value })} />
            </label>
            <label className={field}>Target date
              <input type="date" className={small} value={settings.target_date} min={today} onChange={(event) => setSettings({ ...settings, target_date: event.target.value })} />
            </label>
            <label className={field}>Your level
              <select className={small} value={settings.level ?? ""} onChange={(event) => setSettings({ ...settings, level: (event.target.value || null) as GoalLevel | null })}>
                <option value="">Not set</option><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option>
              </select>
            </label>
            <label className={field}>Hours per week for this goal
              <input type="number" min={0.5} max={112} step={0.5} className={small} value={settings.weekly_hours}
                onChange={(event) => setSettings({ ...settings, weekly_hours: Number(event.target.value) })} />
            </label>
            <label className={`${field} sm:col-span-2`}>Anything to plan around (optional)
              <textarea className={small} rows={2} maxLength={1000} value={settings.constraints} placeholder="e.g. End-sem exams 10–20 Nov, keep those weeks light. Gym only on weekdays."
                onChange={(event) => setSettings({ ...settings, constraints: event.target.value })} />
            </label>
            <div className="sm:col-span-2">
              <button type="button" className="btn-primary" onClick={() => requestDraft(false)} disabled={busy !== null}>
                {busy === "draft" ? <><Spinner />Drafting…</> : <><Sparkles aria-hidden="true" className="h-4 w-4" />Draft roadmap</>}
              </button>
              <span className="ml-3 text-xs text-slate-500">Usually takes a few seconds.</span>
            </div>
          </div>
        )}

        {draft && (
          <div className="space-y-4">
            {draft.summary && <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-700">{draft.summary}</p>}
            <p className="text-xs text-slate-500">
              {settings.start_date} → {settings.target_date} · {settings.weekly_hours} h a week. Untick a section to leave it out; edit or remove anything.
            </p>

            <SectionBox section="metrics" included={sections.includes("metrics")} onToggle={() => toggleSection("metrics")} count={draft.metrics.length}>
              {draft.metrics.map((metric, index) => (
                <div key={index} className="flex items-end gap-2">
                  <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 sm:grid-cols-5">
                    <label className={`${field} col-span-2`}>Metric
                      <input className={small} value={metric.name} onChange={(event) => update((d) => ({ ...d, metrics: d.metrics.map((m, i) => (i === index ? { ...m, name: event.target.value } : m)) }))} />
                    </label>
                    <label className={field}>Unit
                      <input className={small} value={metric.unit ?? ""} onChange={(event) => update((d) => ({ ...d, metrics: d.metrics.map((m, i) => (i === index ? { ...m, unit: event.target.value || null } : m)) }))} />
                    </label>
                    <label className={field}>From
                      <input type="number" step="any" className={small} value={metric.baseline_value ?? ""}
                        onChange={(event) => update((d) => ({ ...d, metrics: d.metrics.map((m, i) => (i === index ? { ...m, baseline_value: event.target.value === "" ? null : Number(event.target.value) } : m)) }))} />
                    </label>
                    <label className={field}>To
                      <input type="number" step="any" className={small} value={metric.target_value ?? ""}
                        onChange={(event) => update((d) => ({ ...d, metrics: d.metrics.map((m, i) => (i === index ? { ...m, target_value: event.target.value === "" ? null : Number(event.target.value) } : m)) }))} />
                    </label>
                    <label className={`${field} col-span-2 sm:col-span-5`}>Adds up
                      <select className={small} value={metric.aggregation}
                        onChange={(event) => update((d) => ({ ...d, metrics: d.metrics.map((m, i) => (i === index ? { ...m, aggregation: event.target.value as MetricAggregation } : m)) }))}>
                        <option value="sum">Daily amounts add up</option><option value="latest">Latest reading counts</option>
                      </select>
                    </label>
                  </div>
                  <RemoveButton label={`Remove metric ${metric.name}`} onClick={() => update((d) => ({ ...d, metrics: d.metrics.filter((_, i) => i !== index) }))} />
                </div>
              ))}
              {existingMetrics.length > 0 && <p className="text-xs text-slate-500">Already tracking: {existingMetrics.join(", ")}.</p>}
            </SectionBox>

            <SectionBox section="phases" included={sections.includes("phases")} onToggle={() => toggleSection("phases")} count={draft.phases.length}>
              {draft.phases.map((phase, index) => (
                <div key={index} className="flex items-start gap-2 border-b border-slate-100 pb-2 last:border-0">
                  <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-4">
                    <label className={`${field} sm:col-span-2`}>{index + 1}. Phase
                      <input className={small} value={phase.title} onChange={(event) => update((d) => ({ ...d, phases: d.phases.map((p, i) => (i === index ? { ...p, title: event.target.value } : p)) }))} />
                    </label>
                    <label className={field}>Starts
                      <input type="date" className={small} value={phase.start_date} onChange={(event) => update((d) => ({ ...d, phases: d.phases.map((p, i) => (i === index ? { ...p, start_date: event.target.value } : p)) }))} />
                    </label>
                    <label className={field}>Ends
                      <input type="date" className={small} value={phase.end_date} onChange={(event) => update((d) => ({ ...d, phases: d.phases.map((p, i) => (i === index ? { ...p, end_date: event.target.value } : p)) }))} />
                    </label>
                    <label className={`${field} sm:col-span-2`}>Focus
                      <input className={small} value={phase.focus ?? ""} onChange={(event) => update((d) => ({ ...d, phases: d.phases.map((p, i) => (i === index ? { ...p, focus: event.target.value || null } : p)) }))} />
                    </label>
                    <label className={`${field} sm:col-span-2`}>Target by the end
                      <input className={small} value={phase.target_note ?? ""} onChange={(event) => update((d) => ({ ...d, phases: d.phases.map((p, i) => (i === index ? { ...p, target_note: event.target.value || null } : p)) }))} />
                    </label>
                  </div>
                  <RemoveButton label={`Remove phase ${phase.title}`} onClick={() => update((d) => ({ ...d, phases: d.phases.filter((_, i) => i !== index) }))} />
                </div>
              ))}
            </SectionBox>

            <SectionBox section="targets" included={sections.includes("targets")} onToggle={() => toggleSection("targets")} count={draft.targets.length}>
              {draft.targets.map((target, index) => (
                <div key={index} className="flex items-end gap-2">
                  <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 sm:grid-cols-6">
                    <label className={`${field} col-span-1 sm:col-span-2`}>Week of
                      <input type="date" className={small} value={target.week_start} onChange={(event) => update((d) => ({ ...d, targets: d.targets.map((t, i) => (i === index ? { ...t, week_start: event.target.value } : t)) }))} />
                    </label>
                    <label className={`${field} col-span-1 sm:col-span-4`}>Target
                      <input className={small} value={target.title} onChange={(event) => update((d) => ({ ...d, targets: d.targets.map((t, i) => (i === index ? { ...t, title: event.target.value } : t)) }))} />
                    </label>
                    <label className={`${field} sm:col-span-4`}>Counts towards
                      <select className={small} value={target.metric_name ?? ""} onChange={(event) => update((d) => ({ ...d, targets: d.targets.map((t, i) => (i === index ? { ...t, metric_name: event.target.value || null } : t)) }))}>
                        <option value="">No metric</option>{metricNames.map((name) => <option key={name} value={name}>{name}</option>)}
                      </select>
                    </label>
                    <label className={`${field} sm:col-span-2`}>Amount
                      <input type="number" step="any" min={0} className={small} value={target.target_value ?? ""}
                        onChange={(event) => update((d) => ({ ...d, targets: d.targets.map((t, i) => (i === index ? { ...t, target_value: event.target.value === "" ? null : Number(event.target.value) } : t)) }))} />
                    </label>
                  </div>
                  <RemoveButton label={`Remove target ${target.title}`} onClick={() => update((d) => ({ ...d, targets: d.targets.filter((_, i) => i !== index) }))} />
                </div>
              ))}
            </SectionBox>

            <SectionBox section="routines" included={sections.includes("routines")} onToggle={() => toggleSection("routines")} count={draft.routines.length}>
              {draft.routines.map((routine, index) => (
                <div key={index} className="flex items-start gap-2 border-b border-slate-100 pb-2 last:border-0">
                  <div className="min-w-0 flex-1 space-y-2">
                    <label className={field}>Routine
                      <input className={small} value={routine.title} onChange={(event) => update((d) => ({ ...d, routines: d.routines.map((r, i) => (i === index ? { ...r, title: event.target.value } : r)) }))} />
                    </label>
                    <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Days for ${routine.title}`}>
                      {ISO_DAYS.map((day) => {
                        const on = routine.days_of_week.includes(day.value);
                        return (
                          <button key={day.value} type="button" aria-pressed={on}
                            onClick={() => update((d) => ({ ...d, routines: d.routines.map((r, i) => (i === index ? { ...r, days_of_week: (on ? r.days_of_week.filter((x) => x !== day.value) : [...r.days_of_week, day.value].sort()) as IsoWeekday[] } : r)) }))}
                            className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${on ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-300 text-slate-500"}`}>
                            {day.short}
                          </button>
                        );
                      })}
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <label className={field}>Minutes
                        <input type="number" min={5} max={600} step={5} className={small} value={routine.minutes}
                          onChange={(event) => update((d) => ({ ...d, routines: d.routines.map((r, i) => (i === index ? { ...r, minutes: Number(event.target.value) } : r)) }))} />
                      </label>
                      <label className={field}>Around
                        <input type="time" className={small} value={routine.preferred_start ?? ""}
                          onChange={(event) => update((d) => ({ ...d, routines: d.routines.map((r, i) => (i === index ? { ...r, preferred_start: event.target.value || null } : r)) }))} />
                      </label>
                      <label className={field}>Adds to
                        <select className={small} value={routine.metric_name ?? ""} onChange={(event) => update((d) => ({ ...d, routines: d.routines.map((r, i) => (i === index ? { ...r, metric_name: event.target.value || null } : r)) }))}>
                          <option value="">No metric</option>{metricNames.map((name) => <option key={name} value={name}>{name}</option>)}
                        </select>
                      </label>
                      <label className={field}>Per session
                        <input type="number" step="any" min={0} className={small} value={routine.metric_amount ?? ""}
                          onChange={(event) => update((d) => ({ ...d, routines: d.routines.map((r, i) => (i === index ? { ...r, metric_amount: event.target.value === "" ? null : Number(event.target.value) } : r)) }))} />
                      </label>
                    </div>
                  </div>
                  <RemoveButton label={`Remove routine ${routine.title}`} onClick={() => update((d) => ({ ...d, routines: d.routines.filter((_, i) => i !== index) }))} />
                </div>
              ))}
            </SectionBox>

            <div className="rounded-xl border border-slate-200 p-3">
              <label className={field}>Ask for changes
                <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                  <input className="input px-2 py-1.5 text-sm" maxLength={500} value={request} onChange={(event) => setRequest(event.target.value)} placeholder="e.g. Make it lighter in exam weeks, add a rest day" />
                  <button type="button" className="btn-secondary shrink-0" onClick={() => requestDraft(true)} disabled={busy !== null || !request.trim()}>
                    {busy === "revise" ? <><Spinner />Revising…</> : <><RotateCcw aria-hidden="true" className="h-4 w-4" />Revise</>}
                  </button>
                </div>
              </label>
            </div>

            {hasRoadmap && (
              <fieldset className="min-w-0 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <legend className="px-1 font-semibold">This goal already has a roadmap</legend>
                <label className="flex items-start gap-2"><input type="radio" name="mode" checked={!replace} onChange={() => setReplace(false)} className="mt-1" />Add the draft to it (it must fit around what&apos;s there)</label>
                <label className="mt-1 flex items-start gap-2"><input type="radio" name="mode" checked={replace} onChange={() => setReplace(true)} className="mt-1" />Replace my current phases, targets and routines (metrics and logged progress are kept)</label>
              </fieldset>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="btn-primary" onClick={save} disabled={busy !== null}>
                {busy === "save" ? <><Spinner />Saving…</> : "Save roadmap"}
              </button>
              <button type="button" className="btn-secondary" onClick={() => { setDraft(null); setError(null); }} disabled={busy !== null}>
                <Plus aria-hidden="true" className="h-4 w-4 rotate-45" />Discard draft
              </button>
            </div>
          </div>
        )}

        {error && <p role="alert" className="mt-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
        {notice && <p role="status" className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p>}
      </div>
    </section>
  );
}
