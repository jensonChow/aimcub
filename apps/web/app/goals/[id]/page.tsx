import { colors, space } from "@ui/tokens";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GoalDetail } from "../../../components/GoalDetail";
import { getDataPort } from "../../../lib/wiring";

// Server component: loads the goal + its decomposition, then hands off to the client
// GoalDetail which subscribes to the RealtimePort and lights milestones up on its own.
export const dynamic = "force-dynamic";

export default async function GoalPage({ params }: { params: { id: string } }) {
  const repo = getDataPort();
  const goal = await repo.getGoal(params.id);
  if (!goal) notFound();

  const milestones = await repo.listMilestones(goal.id);

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: space.xl }}>
      <Link href="/" style={{ color: colors.primary, fontSize: 14, textDecoration: "none" }}>
        ← All goals
      </Link>

      <header style={{ margin: `${space.md}px 0 ${space.lg}px` }}>
        <h1 style={{ margin: 0, fontSize: 26 }}>{goal.title}</h1>
        {goal.description ? (
          <p style={{ color: colors.textMuted, marginTop: space.xs }}>{goal.description}</p>
        ) : null}
        {goal.target_date ? (
          <p style={{ color: colors.textMuted, fontSize: 13, marginTop: space.xs }}>
            Target: {goal.target_date.slice(0, 10)}
          </p>
        ) : null}
      </header>

      <GoalDetail goal={goal} initialMilestones={milestones} />
    </main>
  );
}
