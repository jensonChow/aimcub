# GoalPet

> 通用目标/里程碑追踪器 + 证据摄取层,套上「电子宠物 + 数字收藏 + 主动伴侣」的情感外壳。
> 你照常干活,宠物替你记录每一次真实进展,并在你松懈时来找你。

**核心定位**:coding agent(Claude Code 等)只是众多「证据发射器(emitter)」之一,通过 MCP 上报;git/CI webhook 是另一类 emitter。系统本质是通用目标追踪器,开发者场景是第一个被点亮的子集。

## 架构原则

- **后端唯一事实源 = Supabase**(Postgres + Auth + RLS + Realtime + Storage)。
- **证据 append-only + 幂等**;里程碑完成 / 宠物 / 收藏都是从证据流派生的状态。
- **`@core/*` 是四端唯一逻辑源**(纯 TS、零平台依赖、可单测)。各 app 壳只做 I/O、渲染、平台桥接。
- 精简优先:v1 用 jobs 表 + pg_cron(非 pgmq)、线性里程碑(非 DAG)、单表记忆(无向量)、精灵图(非 Rive)。复杂度按触发条件加回。

## Monorepo 布局

```
packages/
  core/        @core/domain      纯 TS 内核:evaluate / stageForXp / planMerge / normalizeEvidence / validatePlan
  types/       @core/types       zod 领域模型(单一事实源)
  db/          @core/db          Supabase migrations + RLS
  api/         @core/api-client  supabase-js 封装
  llm/         @core/llm         Claude gateway(模型路由 + 计量)
  proactive/   @core/proactive   触发规则 + 渠道 adapter 接口
  ui-tokens/   @ui/tokens        design tokens
apps/
  web/         Next.js @ Vercel              — v1(激活)
  mcp/         MCP server (Streamable HTTP)  — v1(激活)
  ios/         Expo RN                       — v2(占位)
  extension/   Chrome MV3                    — v3(占位)
```

## 开发

```bash
corepack enable pnpm
pnpm install
pnpm build        # turbo 全量构建
pnpm test         # @core/domain 单测
pnpm core:purity  # 校验 core 零平台依赖
```

## 路线图(带可证伪闸门)

- **v0** 地基:monorepo + `@core` + Supabase schema。DoD = core 被 web/mcp 同时 import + 零依赖构建通过。
- **v1a** 验证 H1(零摩擦自动证据):Web 设 goal → 拆解 → MCP/GitHub 证据 → 里程碑**自动点亮**。无宠物。
- **v1b** 验证 H2(情感外壳提升留存):叠加宠物成长 + 收藏 + 宠物口吻 nudge。
- **v2** iOS + APNs;**v3** Chrome + 通用目标泛化;**v4** 商业化(Stripe + iOS IAP)。

详见 `/Users/jenson/.claude/plans/coding-agent-goal-goal-proactive-ios-mc-encapsulated-stonebraker.md`。
