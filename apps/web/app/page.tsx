import { colors, space } from "@ui/tokens";
import { GoalListItem } from "../components/GoalListItem";
import { NewGoalForm } from "../components/NewGoalForm";
import { DEMO_OWNER_ID } from "../lib/mock-repo";
import { getDataPort } from "../lib/wiring";

// Server component: reads goals through the injected DataPort (mock in v1a).
// Always render fresh so a newly created goal shows up in the list.
export const dynamic = "force-dynamic";

export default async function Home() {
  const repo = getDataPort();
  const goals = await repo.listGoals(DEMO_OWNER_ID);
  const withMilestones = await Promise.all(
    goals.map(async (goal) => ({ goal, milestones: await repo.listMilestones(goal.id) })),
  );

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: space.xl }}>
      <header style={{ marginBottom: space.lg }}>
        <h1 style={{ color: colors.primary, margin: 0 }}>Aimcub</h1>
        <p style={{ color: colors.textMuted, marginTop: space.xs }}>
          Set a goal, watch it break down into milestones, then keep working — milestones
          light up by themselves as real evidence arrives.
        </p>
      </header>

      <section style={{ marginBottom: space.xl }}>
        <h2 style={{ fontSize: 20, marginBottom: space.sm }}>New goal</h2>
        <NewGoalForm />
      </section>

      <section>
        <h2 style={{ fontSize: 20, marginBottom: space.sm }}>Your goals</h2>
        {withMilestones.length === 0 ? (
          <p style={{ color: colors.textMuted }}>No goals yet — create one above.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: space.md }}>
            {withMilestones.map(({ goal, milestones }) => (
              <GoalListItem key={goal.id} goal={goal} milestones={milestones} />
            ))}
          </div>
        )}
      </section>

      <p style={{ marginTop: space.xl, color: colors.textMuted, fontSize: 12 }}>
        v1a demo — runs entirely on mocked data, no backend required. Open a goal to see a
        milestone auto-complete on its own.
      </p>
    </main>
  );
}
