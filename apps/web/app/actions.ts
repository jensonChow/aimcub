"use server";

import { revalidatePath } from "next/cache";
import { DEMO_OWNER_ID } from "../lib/mock-repo";
import { getDataPort } from "../lib/wiring";

export interface CreateGoalResult {
  ok: boolean;
  goalId?: string;
  error?: string;
}

/**
 * Server action behind the New Goal form: creates the goal + its decomposition via the
 * injected DataPort (mock today), then returns the new goal id so the client can navigate.
 *
 * TODO(v1a-live): derive ownerId from the authenticated session instead of DEMO_OWNER_ID,
 * and let getDataPort() resolve to the Supabase-backed repo.
 */
export async function createGoalAction(formData: FormData): Promise<CreateGoalResult> {
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const targetDateRaw = String(formData.get("target_date") ?? "").trim();

  if (!title) return { ok: false, error: "Title is required." };

  try {
    const { goal } = await getDataPort().createGoal({
      ownerId: DEMO_OWNER_ID,
      title,
      description: description || undefined,
      targetDate: targetDateRaw || null,
    });
    revalidatePath("/");
    return { ok: true, goalId: goal.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to create goal." };
  }
}
