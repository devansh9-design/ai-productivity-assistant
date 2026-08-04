"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { ActionSubmitButton } from "@/components/action-submit-button";
import { confirmPlan, removePlanBlock, editPlanBlock } from "@/lib/plans/actions";
import type { DailyPlan, FixedCommitment, PlanBlock, PlanUnscheduledTask, Task } from "@/lib/types";

function shortTime(value: string) {
  return value.slice(0, 5);
}

interface PlanTimelineProps {
  plan: DailyPlan;
  blocks: PlanBlock[];
  unscheduledTasks: PlanUnscheduledTask[];
  allTasks: Task[];
  fixedCommitments: FixedCommitment[];
}

function BlockCard({ block, isDraft }: { block: PlanBlock; isDraft: boolean }) {
  const [editing, setEditing] = useState(false);

  const bgClass =
    block.kind === "buffer"
      ? "bg-amber-50 text-amber-800 border-amber-200"
      : block.is_manual
        ? "bg-indigo-50 text-indigo-800 border-indigo-200 ring-2 ring-emerald-400"
        : "bg-indigo-50 text-indigo-800 border-indigo-200";

  return (
    <div className={`rounded-lg border px-3 py-2 text-sm ${bgClass}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold">
            {shortTime(block.start_time)}-{shortTime(block.end_time)}
          </span>
          <span>{block.kind === "buffer" ? "Buffer" : block.title}</span>
          {block.is_manual && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
              manual
            </span>
          )}
        </div>
        {isDraft && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setEditing(!editing)}
              className="rounded px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-100"
            >
              {editing ? "Cancel" : "Edit"}
            </button>
            <ActionForm action={removePlanBlock} resetOnSuccess={false}>
              <input type="hidden" name="block_id" value={block.id} />
              <ActionSubmitButton
                pendingLabel="..."
                className="rounded px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-100"
              >
                Remove
              </ActionSubmitButton>
            </ActionForm>
          </div>
        )}
      </div>
      {isDraft && editing && (
        <ActionForm action={editPlanBlock} className="mt-2 flex items-end gap-2">
          <input type="hidden" name="block_id" value={block.id} />
          <label className="text-xs">
            Start
            <input
              type="time"
              name="start_time"
              defaultValue={shortTime(block.start_time)}
              className="ml-1 rounded border border-slate-300 px-2 py-1 text-xs"
            />
          </label>
          <label className="text-xs">
            End
            <input
              type="time"
              name="end_time"
              defaultValue={shortTime(block.end_time)}
              className="ml-1 rounded border border-slate-300 px-2 py-1 text-xs"
            />
          </label>
          <ActionSubmitButton
            pendingLabel="Saving..."
            className="rounded bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-700"
          >
            Save
          </ActionSubmitButton>
        </ActionForm>
      )}
    </div>
  );
}

const STATUS_LABEL: Record<string, { text: string; className: string }> = {
  draft: { text: "Draft", className: "bg-yellow-100 text-yellow-800" },
  confirmed: { text: "Confirmed", className: "bg-emerald-100 text-emerald-800" },
  superseded: { text: "Superseded", className: "bg-slate-100 text-slate-600" },
  completed: { text: "Completed", className: "bg-blue-100 text-blue-800" },
};

export function PlanTimeline({
  plan,
  blocks,
  unscheduledTasks,
  allTasks,
  fixedCommitments,
}: PlanTimelineProps) {
  const isDraft = plan.status === "draft";
  const badge = STATUS_LABEL[plan.status] ?? STATUS_LABEL.draft;

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.className}`}
          >
            {badge.text}
            {plan.version > 1 ? ` v${plan.version}` : ""}
          </span>
        </div>
        {isDraft && (
          <ActionForm action={confirmPlan} resetOnSuccess={false}>
            <input type="hidden" name="plan_id" value={plan.id} />
            <ActionSubmitButton
              pendingLabel="Confirming..."
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              Confirm plan
            </ActionSubmitButton>
          </ActionForm>
        )}
      </div>

      <div className="mt-4 space-y-2">
        {fixedCommitments.map((commitment) => (
          <div
            key={commitment.id}
            className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700"
          >
            <span className="font-semibold">
              {shortTime(commitment.start_time)}-{shortTime(commitment.end_time)}
            </span>{" "}
            Fixed: {commitment.title}
          </div>
        ))}
        {blocks.map((block) => (
          <BlockCard key={block.id} block={block} isDraft={isDraft} />
        ))}
        {blocks.length === 0 && (
          <p className="text-sm text-slate-600">
            No task blocks fit this day. Review availability and commitments in
            Settings.
          </p>
        )}
        {unscheduledTasks.length > 0 && (
          <div className="pt-2">
            <h3 className="text-sm font-semibold text-slate-900">
              Not scheduled
            </h3>
            {unscheduledTasks.map((item) => (
              <p key={item.id} className="mt-1 text-sm text-slate-600">
                <span className="font-medium text-slate-800">
                  {allTasks.find((task) => task.id === item.task_id)?.title ??
                    "Task"}
                  :
                </span>{" "}
                {item.reason}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
