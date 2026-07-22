# Worktree Report — oss-hygiene

Branch: `claude/oss-hygiene-ef1861` (prompt referred to it as `wt/oss-hygiene`;
this worktree was already checked out on the branch above, so that carries the
commit).

## What changed and why

Added the docs/community layer needed for public-readiness, without deciding
the license (explicitly deferred to the founder):

- `CONTRIBUTING.md` — requirements, the full verification gate, monorepo
  orientation (business logic only in `@core/*`, `apps/*` are shells),
  conventions (English-only, no secrets/local data, `AIMCUB_HOME` isolation),
  where project memory lives, and the license-pending notice.
- `SECURITY.md` — GitHub Security Advisories as the reporting channel (flagged
  as needing to be enabled in repo settings before going public), pre-release/
  `main`-only support, and a key-handling model verified against code (below).
- `CODE_OF_CONDUCT.md` — Contributor Covenant v2.1, enforcement contact left as
  `TODO(founder): set contact method before public flip`.
- `.github/ISSUE_TEMPLATE/{bug_report.yml,feature_request.yml,config.yml}` and
  `.github/PULL_REQUEST_TEMPLATE.md`.
- `README.md` — one new "Contributing & Community" section linking the four
  files above; adjusted the trailing "License choice is intentionally
  undecided" sentence to point at the new section instead of dangling at the
  end of Roadmap Boundary. Nothing else in README changed.

## Decisions and out-of-scope discoveries

- `config.yml`'s contact link uses the real `origin` remote
  (`github.com/jensonChow/aimcub`), checked via `git remote -v`, rather than a
  guessed org/repo path.
- Verified SECURITY.md's key-handling claims against code instead of taking
  the prompt's framing on faith: `apps/cli/src/config.ts:41-49` for the env-var
  list, `packages/store/src/index.ts:593-737` for the `0o600` file-mode claim
  on `settings.json`/`web-settings.json`/`context-sources.json` (also covered
  by `packages/store/src/store.test.ts`). Both check out.
- Left `.github/workflows/`, `CHANGELOG.md`, `docs/`, and all code untouched,
  per the file footprint.
- Handoff items for the founder: no LICENSE file yet (expected, out of scope
  this pass); GitHub private vulnerability reporting isn't yet confirmed
  enabled in repo settings; CODE_OF_CONDUCT.md still needs a real enforcement
  contact before the public flip.

## Secrets audit (report-only)

- **Working tree**: no `.env*` files tracked or present (`.gitignore` already
  excludes them); no committed keys. `git grep` hits for key-shaped strings are
  all test fixtures (`apps/cli/src/config.test.ts`, obviously-fake values like
  `sk-ant-123456`/`sk-ant-secretkey`) or UI placeholders (`"sk-ant-…"`). The
  Supabase project ref/URL in `apps/mcp/wrangler.toml` and doc comments in
  `packages/api/src/supabase.ts` are the expected public-identifier case called
  out in the mission — nothing beyond that.
- **Git history**: `git log --all -G` sweep (full history, all local branches,
  codex snapshot refs, and remotes) for `sk-ant-…`, `sk-proj-…`,
  `AKIA[0-9A-Z]{16}`, `ghp_…`, `BEGIN (RSA|EC|OPENSSH) PRIVATE KEY` — **0 hits**
  on all five real-key-shaped patterns. Broader substring sweeps for
  `service_role` (15 commits) and `sk-ant` (10 commits) exist, but every added
  line is a variable/env-var name, an SQL/RLS comment, or the same
  test/placeholder fixtures above — no literal secret values. Also swept every
  filename ever added across history for `.env*`, `.pem`, `id_rsa`,
  `credentials.json`, `.p12`, `.pfx`, `.key` — none found.
- **Recommendation**: run a full-history `gitleaks`/`trufflehog` scan as a
  founder step before the public flip; this sweep was targeted, not exhaustive.

## Verification evidence

Full gate, all green, no code changes so no test-count deltas:

```
pnpm build       — 9/9 tasks (turbo), desktop core-bundle check passed
pnpm typecheck   — 16/16 tasks
pnpm lint        — 10/10 tasks
pnpm core:purity — @core/domain + @core/types, both clean
pnpm test        — 283 desktop + 187 domain + 170 llm + 114 mcp, all passed
git diff --check — clean
```

Also verified: every relative link/anchor added across the new docs and README
resolves (file-existence + heading check); all three
`.github/ISSUE_TEMPLATE/*.yml` files parse as valid YAML and satisfy GitHub's
issue-form schema shape (`type`/`id`/`label` per field, ≥2 dropdown options).
