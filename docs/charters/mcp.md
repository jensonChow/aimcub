# Worktree Charter — `apps/mcp` (Aimcub MCP server)

> Status: archived historical memory. This charter describes the completed v1a/H1
> hosted evidence-spine worktree. It is not the active roadmap. Current v1 work is
> the local Aim OS agent harness in `docs/v1-spec.md`.

Branch: `v1a/mcp`. This worktree owns **only** `apps/mcp/**` (plus this `CHARTER.md`).

## Scope

The MCP server is Aimcub's differentiated evidence emitter for coding agents
(Claude Code is one evidence *emitter* among many). v1a turns the v0 skeleton
(`ping`) into an authenticated, port-driven server:

1. **OAuth 2.1 resource-server verification** as injectable middleware.
   - `verifyAccessToken(token, deps)` validates a JWT signature against a JWKS
     and checks that `aud` contains this MCP resource identifier.
   - The JWKS verifier is an injected `JWKSResolver` (a jose key-resolution
     function), so tests pass a fake local key set while production uses a
     remote JWKS. The MCP server is a pure **resource server**: it verifies the
     access token and **never forwards** it to downstream services.
2. **MCP tools wired through injected ports** so every external touchpoint is
   mockable:
   - `report_evidence` — an agent reports progress. Input is validated with
     `@core/types` zod schemas, normalized into an Evidence envelope via
     `@core/domain` (`normalizeCommitEvidence` / `normalizeCiEvidence` / a
     generic `mcp_report` normalizer), then handed to the injected
     `EvidenceIngestPort`. Returns an ack `{ accepted, evidenceId, kind }`.
   - `goal_status` / `list_milestones` — read milestones for a goal through the
     injected `AimcubRepo` (`@core/api-client`).
3. **No real network / credentials.** All I/O is behind injected ports. Secrets
   are read from `process.env` only and never required for tests.

## Boundaries

- Modify only files under `apps/mcp/**` and this `CHARTER.md`.
- `packages/types` is the frozen domain contract — never edited. `@core/domain`
  re-exports it; `@core/api-client` defines the data-access contract (`AimcubRepo`,
  `IngestEvidenceInput`). Both are consumed as-is.
- All identifiers / comments / docs are English.

## Mock strategy

- **JWT / JWKS** — real verification via `jose` (an already-available dependency).
  The key resolver is injected, so tests generate a real RS256 keypair, build a
  local JWKS, sign genuine JWTs and exercise real signature verification — no
  crypto is mocked. Only the *remote* JWKS fetch is replaced (production factory
  marked `// TODO(v1a-live)`).
- **Repo (read path)** — `AimcubRepo` is injected; tests pass a hand-rolled fake.
  The production server wires a placeholder repo whose methods throw with a
  `// TODO(v1a-live)` until the supabase-js implementation lands.
- **Ingest (write path)** — `EvidenceIngestPort` is injected; tests pass a spy
  capturing the normalized input. Production wires a placeholder that calls
  `repo.ingestEvidence` once a real repo exists (`// TODO(v1a-live)`).
- **Claude API** — not used by this subsystem in v1a.

## Acceptance criteria

- `pnpm --filter @app/mcp run typecheck` passes.
- `pnpm --filter @app/mcp run test` passes:
  - auth: accepts a JWT with valid signature + correct `aud`; rejects a JWT
    with the wrong `aud`; rejects a JWT with a tampered/invalid signature; rejects
    an expired token and a malformed token.
  - `report_evidence`: maps a commit report → normalized `git_commit` evidence and
    calls the ingest port with the right owner/goal/kind/payload; likewise for a
    CI report and a free-form note (`mcp_report`); rejects input that fails the
    `@core/types` validation.

## Live-integration TODOs (`// TODO(v1a-live)`)

- Real remote JWKS fetch (`createRemoteJWKSet`) + issuer/resource config from env.
- Real `AimcubRepo` (supabase-js, service_role on the write path / RLS on reads).
- Real `EvidenceIngestPort` wiring to `repo.ingestEvidence` with idempotency on
  `(emitter_id, source_event_id)`.
- Map the verified token's `sub` / emitter claims to `ownerId` / `emitterId`
  (today the tool input carries them explicitly for testability).
- Protected-resource metadata endpoint (`/.well-known/oauth-protected-resource`)
  + `WWW-Authenticate` challenge per RFC 9728 / MCP auth spec.
