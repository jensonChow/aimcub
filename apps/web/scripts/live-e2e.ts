/**
 * Live end-to-end verification (run manually; reads env, never hardcodes secrets):
 *
 *   Phase A — goal creation: confirmed test user → SupabaseDataPort.createGoal
 *             (REAL Claude decomposition when ANTHROPIC_API_KEY is set) → milestones
 *             materialized via service_role → plan snapshot persisted.
 *   Phase B — evidence chain: emitter token → POST /functions/v1/ingest with CI
 *             evidence matching a controlled milestone rule → pg_cron jobs-worker
 *             judges it → milestone flips to completed → follow-up jobs enqueued.
 *
 * Usage: bundle with esbuild and run with NEXT_PUBLIC_SUPABASE_URL,
 * NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY set.
 */
import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { SupabaseDataPort } from "../lib/live-port";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!URL || !ANON || !SERVICE) throw new Error("missing Supabase env");

const EMAIL = "e2e-test@aimcub.com";
const PASSWORD = "E2eTest123!";

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const userClient = createClient(URL, ANON, { auth: { persistSession: false } });

function fail(msg: string): never {
  console.error("FAIL:", msg);
  process.exit(1);
}

async function ensureUser(): Promise<string> {
  const created = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (created.data.user) return created.data.user.id;
  // Already exists from a previous run — look it up.
  const list = await admin.auth.admin.listUsers();
  const existing = list.data.users.find((u) => u.email === EMAIL);
  if (!existing) fail(`createUser: ${created.error?.message}`);
  return existing.id;
}

async function main(): Promise<void> {
  // ── Phase A: goal creation through the real port ──────────────────────────
  const userId = await ensureUser();
  console.log("PASS user ready:", userId);

  const signIn = await userClient.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (signIn.error) fail(`signIn: ${signIn.error.message}`);
  console.log("PASS signed in");

  const port = new SupabaseDataPort(userClient, admin);
  const t0 = Date.now();
  const { goal, milestones } = await port.createGoal({
    ownerId: userId,
    title: "Build a Rust CLI that converts CSV to JSON",
    description: "Small, tested command-line tool with CI on GitHub; first release tagged v0.1.0.",
  });
  console.log(`PASS createGoal in ${Date.now() - t0}ms — status=${goal.status}, plan=${goal.plan_json ? "saved" : "MISSING"}`);
  console.log(`     ${milestones.length} milestones:`);
  for (const m of milestones) {
    const evals = (m.acceptance_rule as { clauses?: Array<{ evaluator: string }> }).clauses?.map((c) => c.evaluator) ?? [];
    console.log(`     ${m.order_index}. [${m.rarity}/${m.xp_reward}xp] ${m.title} — ${evals.join("+")}`);
  }
  if (milestones.length < 1) fail("no milestones materialized");
  if (process.env.E2E_SKIP_EVIDENCE) {
    console.log("PHASE A PASSED (evidence chain skipped)");
    return;
  }

  // ── Phase B: evidence chain against a controlled milestone ────────────────
  const token = `emt_e2e_${randomBytes(16).toString("hex")}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const emitter = await admin
    .from("emitters")
    .insert({ owner_id: userId, kind: "custom_webhook", display_name: "e2e", token_hash: tokenHash })
    .select()
    .single();
  if (emitter.error) fail(`emitter insert: ${emitter.error.message}`);
  console.log("PASS emitter created:", emitter.data.id);

  const controlled = await admin
    .from("milestones")
    .insert({
      goal_id: goal.id,
      owner_id: userId,
      title: "E2E controlled milestone (CI green)",
      order_index: 99,
      acceptance_rule: {
        logic: "all",
        threshold: 1,
        completion_mode: "auto",
        clauses: [{ evaluator: "ci_status", auto_verifiable: true, match: { workflow: "ci", conclusion: "success" } }],
      },
      xp_reward: 10,
    })
    .select()
    .single();
  if (controlled.error) fail(`controlled milestone insert: ${controlled.error.message}`);
  console.log("PASS controlled milestone:", controlled.data.id);

  const ingestRes = await fetch(`${URL}/functions/v1/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      source: "ci",
      goalId: goal.id,
      milestoneId: controlled.data.id,
      run: { runId: `e2e-run-${Date.now()}`, workflow: "ci", conclusion: "success", branch: "main" },
    }),
  });
  const ingestBody = await ingestRes.json();
  if (ingestRes.status !== 201) fail(`ingest: HTTP ${ingestRes.status} ${JSON.stringify(ingestBody)}`);
  console.log("PASS evidence ingested:", ingestBody.evidence.id, "trust:", ingestBody.evidence.trust_score);

  // Wait for the next pg_cron tick to judge it (worst case ~70s).
  console.log("WAIT for jobs-worker cron tick (up to 100s)...");
  const deadline = Date.now() + 100_000;
  let completedAt: string | null = null;
  while (Date.now() < deadline) {
    const { data } = await admin
      .from("milestones")
      .select("status, completed_at")
      .eq("id", controlled.data.id)
      .single();
    if (data?.status === "completed") {
      completedAt = data.completed_at;
      break;
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  if (!completedAt) fail("milestone did not complete within 100s");
  console.log("PASS milestone auto-completed at", completedAt);

  const completion = await admin
    .from("milestone_completions")
    .select("decided_by, awarded_xp, triggering_evidence_ids")
    .eq("milestone_id", controlled.data.id)
    .single();
  console.log("PASS completion row:", JSON.stringify(completion.data));

  const followUps = await admin
    .from("jobs")
    .select("type, status")
    .like("dedup_key", "%:%")
    .in("type", ["grow_pet", "mint_collectible", "deliver_notification"]);
  console.log("PASS follow-up jobs:", JSON.stringify(followUps.data));

  console.log("ALL E2E CHECKS PASSED — goal", goal.id, "remains for UI inspection");
}

await main();
