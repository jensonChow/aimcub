import { rarityForEffort, STAGE_THRESHOLDS, stageForXp } from "@core/domain";
import type { EstEffort } from "@core/types";
import { colors, radius, space } from "@ui/tokens";

// 服务端组件:直接 import @core/domain —— 与 MCP 端用同一份宠物成长逻辑(证明四端共享核心)。
export default function Home() {
  const sampleXp = [0, 50, 100, 250, 300, 500];
  const efforts: EstEffort[] = ["xs", "s", "m", "l", "xl"];

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: space.xl }}>
      <h1 style={{ color: colors.primary }}>GoalPet</h1>
      <p style={{ color: colors.textMuted }}>
        照常干活,宠物替你记录每一次真实进展,并在你松懈时来找你。
      </p>

      <section style={{ marginTop: space.lg }}>
        <h2 style={{ fontSize: 20 }}>宠物成长(stageForXp · 来自 @core/domain)</h2>
        <ul>
          {sampleXp.map((xp) => (
            <li key={xp}>
              xp={xp} → <strong>{stageForXp(xp)}</strong>
            </li>
          ))}
        </ul>
        <p style={{ color: colors.textMuted }}>
          阶段阈值:{STAGE_THRESHOLDS.map((t) => `${t.stage}@${t.minXp}`).join(" · ")}
        </p>
      </section>

      <section style={{ marginTop: space.lg }}>
        <h2 style={{ fontSize: 20 }}>收藏稀有度(rarityForEffort · 确定性,非抽卡)</h2>
        <div style={{ display: "flex", gap: space.sm, flexWrap: "wrap" }}>
          {efforts.map((e) => (
            <span
              key={e}
              style={{
                padding: `${space.xs}px ${space.sm}px`,
                borderRadius: radius.pill,
                background: colors.surface,
                border: `1px solid ${colors.primary}`,
              }}
            >
              {e} → {rarityForEffort(e)}
            </span>
          ))}
        </div>
      </section>

      <p style={{ marginTop: space.xl, color: colors.textMuted, fontSize: 12 }}>
        v0 地基:Web 与 MCP 端共享同一个 <code>@core/domain</code>。下一步(v1a):设 goal → 拆解 → 证据自动点亮里程碑。
      </p>
    </main>
  );
}
