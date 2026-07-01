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
import { reviewPlan } from "@core/domain";
import { AnthropicLlmGateway, decomposeWithQuality, planQualityMetadata, type UsageMeter } from "@core/llm";
import type { DecompositionOutput, Goal, Milestone } from "@core/types";
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

  async createGoal(input: CreateGoalInput): Promise<{ goal: Goal; milestones: Milestone[] }> {
    const goal = await this.repo.createGoal(input);
    const planned = await this.plan(input, goal.metadata);
    const decomposition = planned.output;
    const milestones = materialize(decomposition, goal.id, input.ownerId);
    await this.repo.insertMilestones(milestones);
    const updated = await this.repo.updateGoalPlan(goal.id, decomposition, "active", planned.metadata);
    return { goal: updated, milestones };
  }

  /** Claude decomposition with a deterministic local fallback — goal creation never fails on LLM hiccups. */
  private async plan(
    input: CreateGoalInput,
    metadata: Record<string, unknown> = {},
  ): Promise<{ output: DecompositionOutput; metadata?: Record<string, unknown> }> {
    const request = { title: input.title, description: input.description, domain: input.domain };
    if (readEnv().anthropicApiKey) {
      try {
        const gateway = new AnthropicLlmGateway({ meter: LOG_METER, ownerId: input.ownerId });
        const result = await decomposeWithQuality(gateway, request);
        if (result.output) {
          const review = reviewPlan({ plan: result.output, context: [], quality: result.quality });
          return { output: result.output, metadata: { ...metadata, ...planQualityMetadata(result, review) } };
        }
        console.error("[decompose] plan failed validation; using local fallback:", result.validation);
      } catch (err) {
        console.error("[decompose] LLM call failed; using local fallback:", err);
      }
    }
    const output = localDecompose(request);
    const review = reviewPlan({ plan: output, context: [] });
    return {
      output,
      metadata: {
        ...metadata,
        ...planQualityMetadata({ quality: review.quality, retried: false, attempts: 1, firstQuality: review.quality }, review),
      },
    };
  }
}
