import { colors, space } from "@ui/tokens";
import { redirect } from "next/navigation";
import { GoalListItem } from "../components/GoalListItem";
import { NewGoalForm } from "../components/NewGoalForm";
import { getSessionUser } from "../lib/auth";
import { hasLiveBackend } from "../lib/env";
import { getDataPort } from "../lib/wiring";
import { signOutAction } from "./auth-actions";

// Server component: reads goals through the injected DataPort (Supabase in live mode,
// mock otherwise). Always render fresh so a newly created goal shows up in the list.
export const dynamic = "force-dynamic";
// The createGoalAction submitted from this page runs a ~20-30s Claude decomposition;
// lift the serverless timeout above Vercel's default.
export const maxDuration = 60;

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const repo = getDataPort();
  const goals = await repo.listGoals(user.id);
  const withMilestones = await Promise.all(
    goals.map(async (goal) => ({ goal, milestones: await repo.listMilestones(goal.id) })),
  );

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: space.xl }}>
      <header style={{ marginBottom: space.lg }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h1 style={{ color: colors.primary, margin: 0 }}>Aimcub</h1>
          {hasLiveBackend() && user.email ? (
            <form action={signOutAction} style={{ display: "flex", alignItems: "center", gap: space.sm }}>
              <span style={{ color: colors.textMuted, fontSize: 13 }}>{user.email}</span>
              <button
                type="submit"
                style={{
                  background: "transparent",
                  color: colors.textMuted,
                  border: "1px solid #232733",
                  borderRadius: 6,
                  padding: "4px 10px",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                Sign out
              </button>
            </form>
          ) : null}
        </div>
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
        {hasLiveBackend()
          ? "v1a — live: milestones light up the moment verified evidence lands."
          : "v1a demo — running on mocked data, no backend required. Open a goal to see a milestone auto-complete on its own."}
      </p>
    </main>
  );
}
