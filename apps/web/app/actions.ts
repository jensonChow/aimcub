"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "../lib/auth";
import { getDataPort } from "../lib/wiring";

export interface CreateGoalResult {
  ok: boolean;
  goalId?: string;
  error?: string;
}

/**
 * Server action behind the New Goal form: creates the goal + its decomposition via the
 * injected DataPort (Supabase in live mode, mock otherwise), then returns the new goal
 * id so the client can navigate. The owner is always derived from the session — never
 * from the form.
 */
export async function createGoalAction(formData: FormData): Promise<CreateGoalResult> {
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const targetDateRaw = String(formData.get("target_date") ?? "").trim();

  if (!title) return { ok: false, error: "Title is required." };

  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Not signed in." };

  try {
    const { goal } = await getDataPort().createGoal({
      ownerId: user.id,
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
