# @core/db — Supabase schema(数据真相源)

`supabase/migrations/` 下是按序号命名的 SQL 迁移。

## 应用迁移

```bash
# 本地开发(需 Docker):
supabase start
supabase db reset          # 重放全部迁移到本地 stack

# 远程项目:
supabase link --project-ref <ref>
supabase db push
```

或通过 Supabase MCP 工具 `apply_migration` 直接应用到远程项目。

## 生成共享类型

应用迁移后,用 `generate_typescript_types` 产出 DB 类型,并与 `@core/types`(zod 单一事实源)
在 CI 校验漂移。

## 安全分组(RLS)

- **组 A(用户可读写)**:`goals` / `emitters` / `memories`。
- **组 B(用户只读,写入走 service_role)**:`milestones` / `evidence` / `milestone_completions` /
  `pets` / `collectibles` / `notifications` / `subscriptions` —— 防止用户伪造完成/证据/XP/订阅等级。
- **jobs**:内部表,用户无任何访问;`service_role` 绕过 RLS。`claim_jobs(batch)` 供 worker 原子取批。

## 关键不变量

- `evidence` append-only,`(emitter_id, source_event_id)` 唯一 = 幂等键。
- `milestone_completions.milestone_id` 唯一 = 一节点只完成一次。
- `pets.goal_id` 唯一 = 每目标一只宠物。
- `assert_evidence_emitter_owner` 触发器:证据的 emitter 必须属于同一 owner(防跨用户写入)。
