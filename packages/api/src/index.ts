/**
 * @core/api-client — 数据访问契约(implementation-agnostic)。
 * 四端禁止各自拼 query —— 都经此契约访问,保证 query 形态/错误处理一致。
 * v0:定义 GoalPetRepo 接口(用领域类型);具体 supabase-js 实现在 v1a 接入。
 */
import type {
  Collectible,
  Evidence,
  Goal,
  GoalDomain,
  Milestone,
  Notification,
  Pet,
} from "@core/types";

export interface CreateGoalInput {
  ownerId: string;
  title: string;
  description?: string;
  domain?: GoalDomain;
  targetDate?: string | null;
}

/** 摄取入口写入的归一化证据(id/owner 由实现补齐前的形态)。 */
export interface IngestEvidenceInput {
  ownerId: string;
  goalId: string;
  milestoneId?: string | null;
  emitterId?: string | null;
  kind: Evidence["kind"];
  sourceEventId: string | null;
  occurredAt: string;
  summary?: string;
  payload?: Record<string, unknown>;
  trustScore?: number;
}

/**
 * 四端共享的数据访问契约。读路径(用户身份 + RLS)与机器写路径(service_role)分离:
 * 创建目标 = 用户路径;插入里程碑 / 摄取证据 / 成长宠物 = 服务端路径。
 */
export interface GoalPetRepo {
  // 用户路径(RLS 下读写)
  createGoal(input: CreateGoalInput): Promise<Goal>;
  getGoal(id: string): Promise<Goal | null>;
  listGoals(ownerId: string): Promise<Goal[]>;
  listMilestones(goalId: string): Promise<Milestone[]>;
  getPet(goalId: string): Promise<Pet | null>;
  listCollectibles(ownerId: string): Promise<Collectible[]>;
  /** agent_inbox 渠道:宠物给用户的主动消息(Claude Code 经 MCP get_inbox 拉取)。 */
  listInbox(ownerId: string, since?: string): Promise<Notification[]>;

  // 服务端路径(service_role)
  insertMilestones(milestones: Milestone[]): Promise<Milestone[]>;
  ingestEvidence(input: IngestEvidenceInput): Promise<Evidence>;
}

export interface SupabaseClientConfig {
  url: string;
  /** anon key(客户端)或 service_role key(仅服务端)。 */
  key: string;
}
