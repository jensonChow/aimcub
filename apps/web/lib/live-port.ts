/**
 * SupabaseDataPort — the live implementation of the web app's DataPort, built on
 * @core/api-client's SupabaseAimcubRepo (user client = RLS path; admin client =
 * service_role path for milestone materialization).
 *
 * Goal creation pipeline (mirrors the mock exactly, so the UI never changes):
 *   1. insert the goal (user path, RLS),
 *   2. decompose — Claude Structured Output via @core/llm when ANTHROPIC_API_KEY is
 *      set, otherwise the deterministic local plan (always-works fallback),
 *   3. validate + materialize via @core/domain (shared `materialize`),
 *   4. insert milestones (service_role path — users cannot write milestones),
 *   5. persist the plan snapshot + activate the goal (user path).
 */
import type { CreateGoalInput } from "@core/api-client";
import { SupabaseAimcubRepo, type SupabaseLike } from "@core/api-client";
import { AnthropicLlmGateway, decompose, type UsageMeter } from "@core/llm";
import type { Collectible, DecompositionOutput, Goal, Milestone, Notification, Pet } from "@core/types";
import type { DataPort } from "./data-port";
import { localDecompose } from "./decompose";
import { readEnv } from "./env";
import { materialize } from "./mock-repo";

/** v1a: no metering store yet — usage is logged, not persisted. TODO(v1b): persist for quotas. */
const LOG_METER: UsageMeter = {
  async record(ownerId, task, usage) {
    console.log(`[llm] owner=${ownerId} task=${task} model=${usage.model} in=${usage.inputTokens} out=${usage.outputTokens}`);
  },
};

export class SupabaseDataPort implements DataPort {
  private readonly repo: SupabaseAimcubRepo;

  constructor(userClient: unknown, adminClient: unknown) {
    // The real supabase-js client structurally satisfies SupabaseLike.
    this.repo = new SupabaseAimcubRepo(userClient as SupabaseLike, adminClient as SupabaseLike);
  }

  listGoals(ownerId: string): Promise<Goal[]> {
    return this.repo.listGoals(ownerId);
  }

  getGoal(id: string): Promise<Goal | null> {
    return this.repo.getGoal(id);
  }

  listMilestones(goalId: string): Promise<Milestone[]> {
    return this.repo.listMilestones(goalId);
  }

  getPet(goalId: string): Promise<Pet | null> {
    return this.repo.getPet(goalId);
  }

  listCollectibles(ownerId: string): Promise<Collectible[]> {
    return this.repo.listCollectibles(ownerId);
  }

  listNotifications(ownerId: string, limit?: number): Promise<Notification[]> {
    return this.repo.listNotifications(ownerId, limit);
  }

  async createGoal(input: CreateGoalInput): Promise<{ goal: Goal; milestones: Milestone[] }> {
    const goal = await this.repo.createGoal(input);
    const decomposition = await this.plan(input);
    const milestones = materialize(decomposition, goal.id, input.ownerId);
    await this.repo.insertMilestones(milestones);
    const updated = await this.repo.updateGoalPlan(goal.id, decomposition, "active");
    return { goal: updated, milestones };
  }

  /** Claude decomposition with a deterministic local fallback — goal creation never fails on LLM hiccups. */
  private async plan(input: CreateGoalInput): Promise<DecompositionOutput> {
    const request = { title: input.title, description: input.description, domain: input.domain };
    if (readEnv().anthropicApiKey) {
      try {
        const gateway = new AnthropicLlmGateway({ meter: LOG_METER, ownerId: input.ownerId });
        const result = await decompose(gateway, request);
        if (result.output) return result.output;
        console.error("[decompose] plan failed validation; using local fallback:", result.validation);
      } catch (err) {
        console.error("[decompose] LLM call failed; using local fallback:", err);
      }
    }
    return localDecompose(request);
  }
}
