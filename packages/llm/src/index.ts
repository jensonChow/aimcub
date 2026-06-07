/**
 * @core/llm — Claude 调用网关:模型路由 + 计量 + 缓存策略(接口先行)。
 * 计费决策:统一走 Anthropic API key 直连(不用 Agent SDK 订阅额度),成本可计量、可缓存、可 Batch。
 * v0:模型路由 + 网关接口;具体 SDK 调用在 v1a 接入(避免 v0 引入网络依赖)。
 */

/** 2026 模型 ID(精简优先:拆解/重规划/庆祝用 Sonnet,高频 nudge/分类用 Haiku;Opus 仅高光时刻)。 */
export const Models = {
  opus: "claude-opus-4-8",
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5-20251001",
} as const;
export type ModelId = (typeof Models)[keyof typeof Models];

export type LlmTask =
  | "decompose" // 首次拆解
  | "replan" // 增量重规划
  | "celebrate" // 节点达成庆祝(高情感价值)
  | "goal_complete" // 目标完成大庆祝(罕见高光)
  | "nudge" // 日常主动消息(高频)
  | "classify" // 分类/估分/措辞
  | "extract_memory"; // 记忆抽取

/** 任务 → 模型路由。精简版:Opus 只留给 goal_complete;其余 Sonnet/Haiku。 */
export function routeModel(task: LlmTask): ModelId {
  switch (task) {
    case "goal_complete":
      return Models.opus;
    case "decompose":
    case "replan":
    case "celebrate":
      return Models.sonnet;
    case "nudge":
    case "classify":
    case "extract_memory":
      return Models.haiku;
  }
}

export interface LlmUsage {
  model: ModelId;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/** 计量钩子:每次调用上报 usage,供额度/熔断使用。 */
export interface UsageMeter {
  record(ownerId: string, task: LlmTask, usage: LlmUsage): Promise<void>;
}

export interface LlmRequest {
  task: LlmTask;
  system?: string;
  prompt: string;
  /** 强制 structured output 的 JSON Schema(拆解用扁平 nodes+edges)。 */
  schema?: unknown;
  /** 覆盖路由(罕见)。 */
  model?: ModelId;
}

export interface LlmResponse<T = string> {
  output: T;
  usage: LlmUsage;
}

/** 网关接口。具体实现(Anthropic SDK + prompt caching)在 v1a 接入。 */
export interface LlmGateway {
  complete(req: LlmRequest): Promise<LlmResponse<string>>;
  completeStructured<T>(req: LlmRequest & { schema: unknown }): Promise<LlmResponse<T>>;
}
