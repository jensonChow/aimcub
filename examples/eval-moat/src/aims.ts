/**
 * The benchmark fixtures: three personas, three aims, one honestly-accrued history each.
 *
 * Fairness rules these fixtures follow, because the result is worthless without them:
 *
 *  1. The aim text is IDENTICAL in both conditions. Only the store behind it differs. Nothing in a
 *     title or description hints at the persona's constraints — otherwise the bare condition would
 *     be answering a different question.
 *  2. The bare condition is a fair newcomer, not a sabotaged one: a first-run store with the same
 *     aim and no history. It is exactly what a competent planner sees on day one.
 *  3. The context is what prior work would actually leave behind — constraints learned the hard
 *     way, procedures that exist because something failed, an eval signal shaped by a past
 *     definition of done. It is NOT a set of instructions for the plan under test. No fixture row
 *     names a milestone, a step count, or a structure the planner is supposed to reproduce.
 *  4. Every fixture carries context that SHOULD NOT reach the plan — pending candidates, a
 *     deprioritized row, a weakly-inferred row, and context scoped to an unrelated aim. Whether
 *     selection actually holds those back is a result, not an assumption: the first dry run showed
 *     that the unrelated-aim rows are admitted anyway, on function-word overlap. The report names
 *     them so the noise is counted, not celebrated as "more context".
 */
import type { BenchmarkAim } from "./types.ts";

const developerHistory: BenchmarkAim = {
  id: "receipt-scanning",
  label: "Technical · solo desktop-app developer",
  domain: "software",
  title: "Add receipt scanning to my invoicing desktop app",
  description: "A user should be able to drop a photo of a paper receipt into the app and get a draft expense entry they can correct before saving.",
  persona: "A solo developer who maintains a paid invoicing desktop app for freelancers, shipping releases alone.",
  priorAims: [
    {
      key: "expense-export",
      title: "Ship the CSV expense export in the 1.4 release",
      description: "Let users export a date range of expenses as a CSV their accountant can open.",
      domain: "software",
      rationale: "The export was the top support request; it also forced the first honest pass over the expense table.",
      summary: "Export a date range of expenses to accountant-readable CSV.",
      milestones: [
        {
          key: "export-writer",
          title: "Write the CSV export path",
          description: "Serialize a date range of expense rows to CSV with a stable column order.",
          why: "The export is the whole deliverable; everything else supports it.",
          definitionOfDone: "A selected date range writes a CSV whose columns match the accountant's template.",
          requiredEvidence: ["Commit touching the export module with tests."],
          owner: "agent",
          evalSignal: "Done means the file opens in a spreadsheet with no manual repair.",
          proof: {
            kind: "commit",
            messagePattern: "expense export",
            pathGlob: "src/**",
            sha: "e1f2a3b4",
            message: "feat: csv expense export with column contract",
            files: ["src/export/csv.ts", "src/export/csv.test.ts"],
          },
        },
        {
          key: "offline-smoke",
          title: "Run the offline smoke pass before tagging",
          description: "Exercise the release build against a disposable data directory with networking disabled.",
          why: "Two previous releases regressed on machines that were offline at launch.",
          definitionOfDone: "The smoke script completes against a disposable directory with the network off.",
          requiredEvidence: ["Commit recording the smoke script run for this release."],
          owner: "agent",
          evalSignal: "Done means the offline path was exercised, not assumed.",
          proof: {
            kind: "commit",
            messagePattern: "offline smoke",
            pathGlob: "scripts/**",
            sha: "b7c8d9e0",
            message: "chore: offline smoke pass for 1.4",
            files: ["scripts/offline-smoke.sh"],
          },
        },
        {
          key: "notarize-release",
          title: "Notarize and publish the 1.4 build",
          description: "Sign, notarize, and push the build to the update feed.",
          why: "Signing needs the developer's own Apple credentials and cannot be delegated.",
          definitionOfDone: "The signed build is live on the update feed and installs without a Gatekeeper warning.",
          requiredEvidence: ["Developer confirmation that the notarized build is published."],
          owner: "human",
          evalSignal: "Done means a real install from the feed succeeded.",
          proof: {
            kind: "manual",
            summary: "1.4 notarized and published to the update feed",
            proofNote: "Installed the feed build on a clean machine; no Gatekeeper warning.",
          },
        },
      ],
    },
  ],
  otherAims: [
    {
      key: "marketing-site",
      title: "Refresh the product marketing site",
      description: "A slow-burning side aim to rewrite the landing page copy.",
    },
  ],
  context: [
    {
      content: "Constraint: The app must keep working with networking fully disabled, and no customer document or image may leave the device — a cloud API is only acceptable behind an explicit local fallback the user opts into.",
      category: "constraint",
      source: "user_stated",
      priorAim: null,
      note: "Promoted to global after the 1.4 offline regressions.",
    },
    {
      content: "Constraint: Releases ship as a signed, notarized macOS build through the existing update feed; notarization needs the developer's own Apple credentials and cannot be automated away.",
      category: "constraint",
      source: "evidence_derived",
      priorAim: null,
    },
    {
      content: "Procedure: Before tagging any release, run the offline smoke script against a disposable data directory with the network off; the two rollbacks both skipped it.",
      category: "procedure",
      kind: "procedural",
      source: "evidence_derived",
      priorAim: "expense-export",
      note: "Shares 'offline' and 'release' vocabulary with the new aim, so selection can relate it.",
    },
    {
      content: "Preference: Ship one well-tested path rather than a configurable framework; optional code paths in this app have historically shipped untested and regressed.",
      category: "preference",
      source: "user_stated",
      priorAim: null,
    },
    {
      content: "Capability: Solo developer, strong in TypeScript and comfortable in Rust, has never trained or deployed a machine-learning model, and has no budget for a paid API tier.",
      category: "capability",
      source: "user_stated",
      priorAim: null,
    },
    {
      content: "Eval signal: A feature counts as done when it produces a correct result on a machine with networking disabled and the test suite covers the failure path, not only the happy path.",
      category: "eval_signal",
      confidence: 0.92,
      source: "evidence_derived",
      priorAim: null,
    },
    {
      content: "Project fact: Expense rows live in a local SQLite table with a NOT NULL merchant column, so any importer must produce a merchant value or an explicit unknown sentinel.",
      category: "project_fact",
      source: "user_stated",
      priorAim: "expense-export",
    },
    {
      content: "Preference: The marketing site should stay a single static page with no JavaScript framework.",
      category: "preference",
      source: "user_stated",
      priorAim: "marketing-site",
      note: "Noise: scoped to an unrelated aim, and topically irrelevant to receipt scanning.",
    },
    {
      content: "Procedure: Answer support email in one batch on Friday afternoons.",
      category: "procedure",
      kind: "procedural",
      source: "agent_inferred",
      status: "pending",
      priorAim: "expense-export",
      note: "Still a candidate in the inbox — pending context is never injected into planning.",
    },
    {
      content: "Preference: Prefer a dark theme in the settings pane.",
      category: "preference",
      confidence: 0.45,
      source: "agent_inferred",
      priorAim: null,
      note: "Active but weakly inferred — sits under the selector's confidence floor.",
    },
    {
      content: "Project fact: The app used to ship a Windows build.",
      category: "project_fact",
      source: "agent_inferred",
      status: "deprioritized",
      priorAim: null,
      note: "Reviewed down in the context inbox; deprioritized rows leave the active set.",
    },
  ],
};

const studioHistory: BenchmarkAim = {
  id: "pottery-course",
  label: "Non-technical · ceramics studio owner",
  domain: "creative",
  title: "Launch a four-week evening pottery course for beginners",
  description: "I want to run a beginner course over four weekly evening sessions and have it actually fill up.",
  persona: "The owner of a small two-room ceramics studio who teaches, fires, and handles bookings personally.",
  priorAims: [
    {
      key: "glazing-workshop",
      title: "Run the spring one-day glazing workshop",
      description: "A single Saturday glazing workshop for eight past students.",
      domain: "creative",
      rationale: "A one-day format was the cheapest way to test demand before committing to a longer course.",
      summary: "Fill and run a one-day spring glazing workshop.",
      milestones: [
        {
          key: "kiln-slot",
          title: "Reserve the kiln window around the workshop",
          description: "Block the firing and cooldown window so no other work competes for the kiln.",
          why: "The studio has one kiln and a firing plus cooldown occupies more than a day.",
          definitionOfDone: "The firing and cooldown window is blocked in the studio calendar before registration opens.",
          requiredEvidence: ["Owner confirmation that the kiln window is blocked."],
          owner: "human",
          evalSignal: "Done means no other booking can claim the kiln that week.",
          proof: {
            kind: "manual",
            summary: "Kiln window blocked for the spring workshop",
            proofNote: "Firing Thursday night, cooldown Friday, workshop Saturday — calendar blocked.",
          },
        },
        {
          key: "waiver-pack",
          title: "Get signed waivers from every attendee",
          description: "Collect the insurer's liability waiver before anyone touches a wheel.",
          why: "The studio's insurance is void without a signed waiver per attendee.",
          definitionOfDone: "Every registered attendee has a signed waiver on file before the session starts.",
          requiredEvidence: ["Owner confirmation that all waivers are on file."],
          owner: "human",
          evalSignal: "Done means zero attendees without a waiver, not most attendees.",
          proof: {
            kind: "manual",
            summary: "All eight waivers collected before the session",
            proofNote: "Two arrived the morning of; chasing them cost an hour.",
          },
        },
        {
          key: "list-announce",
          title: "Announce to the mailing list and open deposits",
          description: "Send the announcement and open 50% deposit bookings.",
          why: "The mailing list has filled every previous session without paid advertising.",
          definitionOfDone: "The announcement is sent and deposit bookings are open on the checkout page.",
          requiredEvidence: ["Owner confirmation that the announcement went out and bookings opened."],
          owner: "human",
          evalSignal: "Done means seats are paid for, not merely reserved.",
          proof: { kind: "open" },
        },
      ],
    },
  ],
  otherAims: [
    {
      key: "wholesale-mugs",
      title: "Keep the cafe wholesale mug order running",
      description: "A standing monthly production commitment for the corner cafe.",
    },
  ],
  context: [
    {
      content: "Constraint: The studio has one kiln; a bisque firing plus cooldown takes about 14 hours, so no two sessions that both need fired work can sit on consecutive days.",
      category: "constraint",
      source: "user_stated",
      priorAim: null,
    },
    {
      content: "Constraint: The insurer caps a session at 8 students and voids cover unless every student has signed the liability waiver before touching a wheel.",
      category: "constraint",
      source: "user_stated",
      priorAim: null,
    },
    {
      content: "Preference: Sell to the mailing list of roughly 600 past students first; the owner will not buy social ads and will not make video content.",
      category: "preference",
      source: "user_stated",
      priorAim: null,
    },
    {
      content: "Procedure: Open registration exactly three weeks ahead with a 50% deposit; opening earlier produced a 40% no-show rate on the last two sessions.",
      category: "procedure",
      kind: "procedural",
      source: "evidence_derived",
      priorAim: "glazing-workshop",
    },
    {
      content: "Capability: The owner teaches every session and does all firing; a part-time assistant is available on Saturdays only, and nobody on the team edits video or writes code.",
      category: "capability",
      source: "user_stated",
      priorAim: null,
    },
    {
      content: "Eval signal: A workshop counts as successful when at least 6 of 8 seats are paid in full a week before it starts and every student leaves with a fired piece.",
      category: "eval_signal",
      confidence: 0.9,
      source: "evidence_derived",
      priorAim: null,
    },
    {
      content: "Project fact: Bookings and deposits run through the studio's existing Square checkout; refunds are manual and the deposit policy must appear on the checkout page.",
      category: "project_fact",
      source: "user_stated",
      priorAim: "glazing-workshop",
    },
    {
      content: "Constraint: The wholesale mug order for the corner cafe ships on the last Friday of each month.",
      category: "constraint",
      source: "user_stated",
      priorAim: "wholesale-mugs",
      note: "Noise: a real commitment, but scoped to an unrelated aim and irrelevant to teaching a course.",
    },
    {
      content: "Preference: Consider raising the open-studio membership price next year.",
      category: "preference",
      source: "agent_inferred",
      status: "pending",
      priorAim: "glazing-workshop",
      note: "Pending candidate; never injected.",
    },
  ],
};

const nonprofitHistory: BenchmarkAim = {
  id: "impact-report",
  label: "Mixed · nonprofit program manager",
  domain: "custom",
  title: "Produce the 2026 annual impact report for our literacy program",
  description: "We need this year's impact report ready for the funder, covering what the program did and what changed for participants.",
  persona: "The single program manager of a small literacy nonprofit, who writes, coordinates, and reports to a board.",
  priorAims: [
    {
      key: "donor-update",
      title: "Publish the 2025 mid-year donor update",
      description: "A short mid-year update to donors covering program numbers and two participant stories.",
      domain: "custom",
      rationale: "The mid-year update was the dry run that exposed how long reconciliation and releases actually take.",
      summary: "Ship the mid-year donor update with verified numbers.",
      milestones: [
        {
          key: "reconcile-numbers",
          title: "Reconcile program numbers against the finance export",
          description: "Pull participation numbers and check them against the finance export before writing.",
          why: "An unreconciled number reached print the year before and had to be corrected publicly.",
          definitionOfDone: "Every number in the draft traces to a reconciled source.",
          requiredEvidence: ["Program manager confirmation that numbers reconcile."],
          owner: "human",
          evalSignal: "Done means each figure has a traceable source, not a plausible one.",
          proof: {
            kind: "manual",
            summary: "Mid-year numbers reconciled against the finance export",
            proofNote: "Two participation counts disagreed by 11; the finance export won.",
          },
        },
        {
          key: "story-releases",
          title: "Collect signed releases for participant stories",
          description: "Route release forms through the partner school for each story used.",
          why: "No participant detail may be published without a signed release.",
          definitionOfDone: "Every story in the draft has a signed release on file.",
          requiredEvidence: ["Program manager confirmation that releases are on file."],
          owner: "human",
          evalSignal: "Done means a release exists for every named participant.",
          proof: {
            kind: "manual",
            summary: "Two signed releases returned via the partner school",
            proofNote: "Took 16 days end to end; one family declined and the story was dropped.",
          },
        },
        {
          key: "accessible-pdf",
          title: "Produce the accessible tagged PDF",
          description: "Hand the layout to the freelance designer and check the accessibility output.",
          why: "The funder rejects untagged PDFs.",
          definitionOfDone: "The tagged PDF passes the funder's screen-reader check.",
          requiredEvidence: ["Confirmation that the tagged PDF passed the accessibility check."],
          owner: "mixed",
          evalSignal: "Done means the accessibility check passes, not that the file looks fine.",
          proof: { kind: "open" },
        },
      ],
    },
  ],
  otherAims: [
    {
      key: "office-lease",
      title: "Decide on the office lease renewal",
      description: "An open operations decision unrelated to the reporting cycle.",
    },
  ],
  context: [
    {
      content: "Constraint: No participant name, photo, or school identifier may be published without a signed release, and releases route through the partner school on a roughly two-week turnaround.",
      category: "constraint",
      source: "user_stated",
      priorAim: null,
    },
    {
      content: "Constraint: The board signs off on the draft at its quarterly meeting and only one meeting falls before the funder deadline, so missing that draft date costs a full quarter.",
      category: "constraint",
      source: "user_stated",
      priorAim: null,
    },
    {
      content: "Procedure: Pull program numbers from the Airtable base and reconcile them against the finance export before any writing starts; an unreconciled number reached print once already.",
      category: "procedure",
      kind: "procedural",
      source: "evidence_derived",
      priorAim: "donor-update",
    },
    {
      content: "Preference: The director wants participant experience carried by direct quotes rather than adjectives, and rejects words like transformative or life-changing in drafts.",
      category: "preference",
      source: "user_stated",
      priorAim: null,
    },
    {
      content: "Capability: One program manager writes and coordinates everything; layout goes to a freelance designer who must be booked about three weeks ahead, and there is no in-house data analyst.",
      category: "capability",
      source: "user_stated",
      priorAim: null,
    },
    {
      content: "Eval signal: A report is done when every number traces to a reconciled source, every quote has a signed release on file, and the tagged PDF passes the funder's screen-reader check.",
      category: "eval_signal",
      confidence: 0.94,
      source: "evidence_derived",
      priorAim: null,
    },
    {
      content: "Project fact: The funder requires an accessible tagged PDF plus a plain-text summary under 500 words.",
      category: "project_fact",
      source: "user_stated",
      priorAim: "donor-update",
    },
    {
      content: "Project fact: The office lease renewal decision is due in November.",
      category: "project_fact",
      source: "user_stated",
      priorAim: "office-lease",
      note: "Noise: scoped to an unrelated operations aim, irrelevant to the reporting cycle.",
    },
    {
      content: "Capability: A board member has offered to help with photography.",
      category: "capability",
      source: "agent_inferred",
      status: "pending",
      priorAim: "donor-update",
      note: "Pending candidate; never injected.",
    },
  ],
};

/** The committed benchmark set. Add an aim by appending here — see the README. */
export const BENCHMARK_AIMS: readonly BenchmarkAim[] = [developerHistory, studioHistory, nonprofitHistory];

export function benchmarkAim(id: string): BenchmarkAim | null {
  return BENCHMARK_AIMS.find((aim) => aim.id === id) ?? null;
}

/**
 * The persona's full active context — the yardstick both plans are measured against. Pending and
 * deprioritized rows are excluded because they are not what the user actually knows to be true.
 */
export function groundTruthContext(aim: BenchmarkAim): Array<{ content: string; category: string }> {
  return aim.context
    .filter((row) => (row.status ?? "active") === "active")
    .map((row) => ({ content: row.content, category: row.category }));
}
