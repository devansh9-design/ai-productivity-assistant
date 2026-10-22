"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { isValidISODate } from "@/lib/tasks/date-validation";
import type { AvailabilityRuleKind } from "@/lib/types";

const RULE_KINDS: AvailabilityRuleKind[] = ["working", "high_focus", "class", "sleep", "meal", "travel", "break", "exercise"];

function requiredText(formData: FormData, key: string, label: string) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) throw new Error(`${label} is required.`);
  return value;
}

function validTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function validateTimeRange(startTime: string, endTime: string) {
  if (!validTime(startTime) || !validTime(endTime) || endTime <= startTime) {
    throw new Error("Choose a valid same-day start and end time.");
  }
}

export async function createAvailabilityRule(formData: FormData) {
  const { supabase, user } = await requireUser();
  const weekday = Number.parseInt(requiredText(formData, "weekday", "Weekday"), 10);
  const kind = requiredText(formData, "kind", "Rule type");
  const startTime = requiredText(formData, "start_time", "Start time");
  const endTime = requiredText(formData, "end_time", "End time");
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !RULE_KINDS.includes(kind as AvailabilityRuleKind)) throw new Error("Choose a valid schedule rule.");
  validateTimeRange(startTime, endTime);
  const { error } = await supabase.from("availability_rules").insert({ user_id: user.id, weekday, kind, start_time: startTime, end_time: endTime });
  if (error) throw new Error(error.message);
  revalidatePath("/settings");
}

export async function deleteAvailabilityRule(formData: FormData) {
  const { supabase, user } = await requireUser();
  const id = requiredText(formData, "id", "Rule id");
  const { error } = await supabase.from("availability_rules").delete().eq("id", id).eq("user_id", user.id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings");
}

export async function createFixedCommitment(formData: FormData) {
  const { supabase, user } = await requireUser();
  const title = requiredText(formData, "title", "Title");
  const commitmentDate = requiredText(formData, "commitment_date", "Date");
  const startTime = requiredText(formData, "start_time", "Start time");
  const endTime = requiredText(formData, "end_time", "End time");
  if (!isValidISODate(commitmentDate) || title.length > 200) throw new Error("Enter a valid commitment.");
  validateTimeRange(startTime, endTime);
  const { error } = await supabase.from("fixed_commitments").insert({ user_id: user.id, title, commitment_date: commitmentDate, start_time: startTime, end_time: endTime });
  if (error) throw new Error(error.message);
  revalidatePath("/settings");
  revalidatePath("/today");
}

export async function deleteFixedCommitment(formData: FormData) {
  const { supabase, user } = await requireUser();
  const id = requiredText(formData, "id", "Commitment id");
  const { error } = await supabase.from("fixed_commitments").delete().eq("id", id).eq("user_id", user.id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings");
  revalidatePath("/today");
}
