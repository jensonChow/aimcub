/**
 * 拆解校验 + 重规划合并。
 * - validatePlan:LLM 输出的语义校验(grammar 管不了的:无环 / id 唯一 / 数量上限)。
 * - planMerge:re-plan 的核心不变量 —— 已完成节点永久 freeze,绝不被覆盖/丢失。
 */
import { type DecompositionOutput, type MilestoneStatus, type PlanEdge } from "@core/types";

export interface PlanValidation {
  ok: boolean;
  errors: string[];
}

/** edge {from, to} 语义:from 必须先完成,to 才能开始(有向边 from→to)。检测有向环。 */
function hasCycle(keys: string[], edges: PlanEdge[]): boolean {
  const adj = new Map<string, string[]>();
  for (const k of keys) adj.set(k, []);
  for (const e of edges) adj.get(e.from)?.push(e.to);

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const k of keys) color.set(k, WHITE);

  const dfs = (u: string): boolean => {
    color.set(u, GRAY);
    for (const v of adj.get(u) ?? []) {
      const cv = color.get(v) ?? WHITE;
      if (cv === GRAY) return true;
      if (cv === WHITE && dfs(v)) return true;
    }
    color.set(u, BLACK);
    return false;
  };

  for (const k of keys) {
    if ((color.get(k) ?? WHITE) === WHITE && dfs(k)) return true;
  }
  return false;
}

export function validatePlan(output: DecompositionOutput): PlanValidation {
  const errors: string[] = [];
  const keys = output.nodes.map((n) => n.key);
  const keySet = new Set(keys);

  if (keySet.size !== keys.length) errors.push("duplicate node keys");
  if (output.nodes.length < 1 || output.nodes.length > 15) {
    errors.push("node count out of range (1..15)");
  }

  for (const e of output.edges) {
    if (!keySet.has(e.from)) errors.push(`edge.from references unknown node: ${e.from}`);
    if (!keySet.has(e.to)) errors.push(`edge.to references unknown node: ${e.to}`);
    if (e.from === e.to) errors.push(`self-dependency: ${e.from}`);
  }

  if (errors.length === 0 && hasCycle(keys, output.edges)) {
    errors.push("dependency cycle detected");
  }

  return { ok: errors.length === 0, errors };
}

// ── re-plan 合并 ──────────────────────────────────────────────────────────

export type MergeAction = "freeze" | "update" | "add" | "skip";

export interface ExistingMilestone {
  id: string;
  title: string;
  status: MilestoneStatus;
}

export interface MergedItem {
  action: MergeAction;
  existingId: string | null;
  nodeKey: string | null;
  title: string;
}

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * 把新拆解结果合并进现有里程碑。硬不变量:
 *  - 已 completed 的节点 → 永远 freeze(即使 LLM 弃用也保留,完成的努力不丢)。
 *  - 标题语义匹配上的未完成节点 → update(沿用稳定 id)。
 *  - 新增节点 → add。 消失的未完成节点 → skip(软删,不物理删除)。
 */
export function planMerge(existing: ExistingMilestone[], next: DecompositionOutput): MergedItem[] {
  const byTitle = new Map<string, ExistingMilestone>();
  for (const m of existing) byTitle.set(norm(m.title), m);

  const usedExisting = new Set<string>();
  const result: MergedItem[] = [];

  for (const node of next.nodes) {
    const match = byTitle.get(norm(node.title));
    if (match) {
      usedExisting.add(match.id);
      if (match.status === "completed") {
        result.push({ action: "freeze", existingId: match.id, nodeKey: node.key, title: match.title });
      } else {
        result.push({ action: "update", existingId: match.id, nodeKey: node.key, title: node.title });
      }
    } else {
      result.push({ action: "add", existingId: null, nodeKey: node.key, title: node.title });
    }
  }

  for (const m of existing) {
    if (usedExisting.has(m.id)) continue;
    if (m.status === "completed") {
      result.push({ action: "freeze", existingId: m.id, nodeKey: null, title: m.title });
    } else {
      result.push({ action: "skip", existingId: m.id, nodeKey: null, title: m.title });
    }
  }

  return result;
}
