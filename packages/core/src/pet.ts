/**
 * 宠物成长(每目标一只):纯数值 + 派生阶段。无事件溯源 —— 宠物表是物化缓存,
 * 真正事实源是 milestone_completions,坏了重算即可。
 */
import { type EstEffort, type PetBranch, type PetStage, type Rarity } from "@core/types";

/** v1 三阶段阈值(蛋 → 幼体 → 成体)。后续阶段加阈值即可扩展。 */
export const STAGE_THRESHOLDS: ReadonlyArray<{ stage: PetStage; minXp: number }> = [
  { stage: "egg", minXp: 0 },
  { stage: "baby", minXp: 100 },
  { stage: "adult", minXp: 300 },
];

export function stageForXp(xp: number): PetStage {
  let stage: PetStage = "egg";
  for (const t of STAGE_THRESHOLDS) {
    if (xp >= t.minXp) stage = t.stage;
  }
  return stage;
}

export interface PetGrowth {
  xp: number;
  stage: PetStage;
  /** 本次是否发生阶段跃迁(用于触发庆祝动画 / 主动消息)。 */
  stagedUp: boolean;
}

/** 施加一次 XP 增益,返回新的 xp/stage 与是否跃迁。 */
export function applyXpGain(currentXp: number, deltaXp: number): PetGrowth {
  const before = stageForXp(currentXp);
  const xp = currentXp + deltaXp;
  const stage = stageForXp(xp);
  return { xp, stage, stagedUp: stage !== before };
}

/** 进化分支:由该 goal 完成里程碑的领域标签分布决定(后端多→龙,前端多→鸟)。 */
const BRANCH_BY_TAG: Readonly<Record<string, PetBranch>> = {
  backend: "dragon",
  frontend: "bird",
  data: "turtle",
  devops: "fox",
};

export function computeBranch(tagCounts: Record<string, number>): PetBranch {
  let best: PetBranch = "unset";
  let bestN = 0;
  for (const [tag, n] of Object.entries(tagCounts)) {
    const branch = BRANCH_BY_TAG[tag];
    if (branch !== undefined && n > bestN) {
      best = branch;
      bestN = n;
    }
  }
  return best;
}

/** 确定性稀有度:由里程碑难度(est_effort)直接决定,不随机(价值来自难度而非抽卡)。 */
export function rarityForEffort(effort: EstEffort): Rarity {
  switch (effort) {
    case "xs":
    case "s":
      return "common";
    case "m":
      return "uncommon";
    case "l":
      return "rare";
    case "xl":
      return "epic";
  }
}
