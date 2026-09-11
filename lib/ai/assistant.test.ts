import { describe, expect, it } from "vitest";
import { buildAiContext, validateAiProposal } from "./assistant";

describe("AI assistant proposal validation", () => {
  it("accepts a valid structured proposal", () => {
    expect(validateAiProposal({
      proposal_type: "suggest_schedule",
      summary: "Focus on DSA first.",
      rationale: "It is high priority and fits the available time.",
      actions: [{
        type: "schedule_task",
        task_id: "task-1",
        title: "DSA",
        start_time: "18:00",
        end_time: "19:00",
        estimated_minutes: 60,
        due_date: "2026-09-11",
        priority: "high",
        description: null,
      }],
      warnings: [],
      requires_confirmation: true,
    }).proposal_type).toBe("suggest_schedule");
  });

  it("rejects unsupported proposal types", () => {
    expect(() => validateAiProposal({
      proposal_type: "delete_calendar",
      summary: "bad",
      rationale: "bad",
      actions: [],
      warnings: [],
      requires_confirmation: false,
    })).toThrow();
  });
});

describe("AI assistant context", () => {
  it("filters completed tasks from incomplete_tasks", () => {
    const context = buildAiContext({
      date: "2026-09-11",
      timeZone: "Asia/Kolkata",
      message: "What should I do?",
      tasks: [
        { id:"1",user_id:"u",goal_id:null,project_id:null,milestone_id:null,title:"Open",description:null,category:null,status:"todo",priority:"high",urgency:5,impact:5,must_do:true,estimated_minutes:30,actual_minutes:null,due_date:null,energy_level:"high",status_reason:null,created_at:"",updated_at:"",completed_at:null },
        { id:"2",user_id:"u",goal_id:null,project_id:null,milestone_id:null,title:"Done",description:null,category:null,status:"completed",priority:"high",urgency:5,impact:5,must_do:true,estimated_minutes:30,actual_minutes:30,due_date:null,energy_level:"high",status_reason:null,created_at:"",updated_at:"",completed_at:"" },
      ],
      plans: [], blocks: [], commitments: [], goals: [], projects: [], milestones: [], checkins: [], journals: [], calendarEvents: [],
    });
    expect(context.incomplete_tasks.map((t) => t.id)).toEqual(["1"]);
  });
});
