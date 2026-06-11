# The Aimcub Story — the human-centered narrative

> One line: **Work as usual — your pet records every real bit of progress, and comes to find you when you slack off.**

This doc is the narrative baseline for everything outward-facing: website copy, onboarding, the v3
general-user decomposition prompt. The protagonist is always **a person and the outcome they want** —
never the toolchain and its events. Commits, webhooks, and evaluators are how the magic works, not
what the story is about.

## The three things a person does

For any goal — a website, a dinner, an article, a video — Aimcub asks exactly three things of you:

1. **Say what you want.** One sentence, in your own words.
2. **Connect your helpers.** The tools and agents you already work with (Claude, your photo library,
   your docs, your publishing platform). Connecting a helper is itself the first milestone of almost
   any goal.
3. **Gather your materials.** The photos, the drafts, the ingredients — whatever the goal needs.

Everything after that is you living your life. Progress is recorded as a byproduct, never as a chore.
There are no check-ins, no streaks to maintain, no forms to fill. Your pet grows when real things
happen, and gently checks in when nothing does.

## A walkthrough: Yu's studio website

Yu is a photographer. She can't code, and shouldn't have to.

She tells her pet: *"I want a website for my photography studio — portfolio and booking info."*

Aimcub breaks that into **her** to-dos, not engineering steps:

| Milestone | What Yu does | How Aimcub knows it happened |
|---|---|---|
| Find your helper | Connects an agent (e.g. Claude) | The connection itself is the evidence |
| Gather your materials | Picks 20 best shots, writes a bio, registers a domain | Files uploaded; one tap to confirm the domain |
| Let the helper build | Tells the agent "build it with these" | The agent reports its own work when it finishes |
| The site is alive | Nothing | Aimcub visits the URL; it loads → the milestone lights itself |
| Tell the world | Posts the link | A quick AI glance confirms it's really the live portfolio |

Her total real workload: one sentence, one connection, one afternoon of picking photos. Each time a
milestone lights, her pet grows. When she stalls on the photos for three days, the pet asks:
*"Picked your shots yet? Maybe start with just five."*

## More goals, same skeleton

- **A family dinner for New Year's Eve**: plan the menu → buy the ingredients → one trial run → dinner
  on the table. Evidence is a photo (AI glances: "yes, that's braised pork") or a single tap when the
  pet asks on Friday night, "got the groceries?" Here the gentle nudge matters more than automation.
- **A long-form article**: outline → draft → two revisions → published. The writing happens in the
  person's own editor — its edit activity is a natural evidence stream (exactly what git is to a
  developer). "Published" = the link is live.
- **A developer shipping a CLI** (live today): set the goal, connect once, push code as usual — the
  milestone lights itself within a minute of the push. Same skeleton, strictest evidence.

## Why the skeleton never changes

The interaction loop — *goal → decomposition → connect evidence sources → live your life → milestones
light → pet grows* — is identical across all of these. Only the translators at the two ends vary:

- **Evidence emitters generalize.** A developer's emitters are git and CI. Everyone else's are their
  photo library, documents, publishing platforms, calendars, an agent's work report, even a sentence
  said to the pet. The MCP "agent reports its own work" channel built for Claude Code is the same
  socket any future consumer agent plugs into.
- **Evaluators generalize.** The schema already reserves `manual_confirm` (one tap), `file_uploaded`
  (a photo), `url` (the link is live), and `llm_judge` (an AI glance) alongside the developer-grade
  `commit_pattern` / `ci_status`. The life scenarios above are built from those four — shipping in v3.
- **Milestone zero is universal.** Almost every goal starts with "connect your helpers and evidence
  sources" — and that step is already a product surface (the MCP/OAuth attach flow), not a tutorial.

## Narrative guardrails

- The person is the protagonist; tools and agents are helpers; the pet is the witness and companion.
- Outcome language over process language: "the site is alive," not "deployment succeeded."
- The pet records and encourages; it never shames, never threatens, never demands check-ins.
- Honesty is the brand: the pet only celebrates **real** progress — that's why evidence is verified.

## Sequencing (why developers first)

v1a proves the hardest version of the promise — fully automatic, verified, zero-check-in evidence —
with the audience whose tools make that possible today (developers). v1b adds the emotional shell.
v3 swaps in the four life evaluators and this story becomes true for everyone, with the interaction
unchanged.
