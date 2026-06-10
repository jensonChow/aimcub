# AUTH_FINDINGS — aud-bound MCP token (RFC 8707) P0

Owner: `v1a/data`. Audience: the `v1a/mcp` worktree (this finding drives its auth design).
Researched June 2026 against current Supabase Auth, the MCP authorization spec, and
Cloudflare `workers-oauth-provider`. All sources cited at the bottom.

## The question

> Can Supabase Auth issue a JWT whose `aud` claim is bound to a specific MCP resource server
> (per RFC 8707 resource indicators), so the MCP server can safely accept it as a bearer token?

This matters because the **2025-06 / 2025-11 MCP authorization spec makes RFC 8707 mandatory**:
the MCP client MUST send a `resource` parameter (the MCP server's canonical URI) on both the
authorization and token requests, and the issued access token MUST be audience-bound to that
resource. The point is to stop a malicious or compromised MCP server from **replaying** a token
it received at a different resource server ("confused deputy" / token mis-redemption). A general
Supabase user JWT (`aud: "authenticated"`) is exactly the kind of broadly-scoped token the spec
is trying to eliminate.

## What Supabase Auth gives us today (2026)

1. **Default user JWTs are NOT resource-bound.** A normal Supabase session token carries
   `aud: "authenticated"` (or `"anon"`). That is an audience in name only — it does not identify a
   resource server, so it is unsuitable as the MCP bearer token under the spec.

2. **Supabase ships an OAuth 2.1 *authorization server* (beta, all plans).** It exposes the
   standard endpoints:
   - authorize: `…/auth/v1/oauth/authorize`
   - token: `…/auth/v1/oauth/token`
   - JWKS: `…/auth/v1/.well-known/jwks.json`
   - OIDC discovery: `…/auth/v1/.well-known/openid-configuration`

   It supports Dynamic Client Registration-style flows and **asymmetric signing (RS256/ES256)**,
   which is what a resource server needs to verify tokens via JWKS without a shared secret.
   (Asymmetric keys are *required* if you request the `openid` scope.)

3. **The `aud` claim can be customized per OAuth client via a Custom Access Token Hook.** The hook
   runs on every token issuance and may set `aud` (the docs explicitly cite "customizing the
   audience claim for different OAuth clients so third-party services can validate tokens were
   issued specifically for them"). RLS keeps working: the access token still carries `sub`/`role`,
   and policies can additionally branch on `client_id` via `(auth.jwt() ->> 'client_id')`.

4. **The gap: Supabase does NOT natively implement RFC 8707 resource indicators.** Critically, the
   Custom Access Token Hook input does **not receive the `resource` parameter** from the OAuth
   request — it gets `user_id`, `claims`, `authentication_method`, and (in OAuth flows) `client_id`.
   So Supabase can give a token a *fixed* `aud` per registered OAuth client, but it cannot, out of
   the box, read the requested `resource` and dynamically mint an `aud` equal to that resource's
   canonical URI. There is no built-in `resource`-param plumbing, and `aud` cannot be validated
   against an allowed-resource list inside the AS.

### Net assessment

Supabase Auth can be coerced into being *audience-aware* (one `aud` per OAuth client, JWKS-verifiable),
but it is **not a spec-complete RFC 8707 authorization server**: it does not accept/echo the
`resource` parameter, so strict resource-indicator binding is not natively available in 2026.

## The two candidate paths

### Path A — Supabase as a single-JWKS resource-aware AS (one OAuth client per MCP resource)

- Register the MCP server as an OAuth client in Supabase's OAuth 2.1 server.
- Use a Custom Access Token Hook to stamp a **fixed `aud` = the MCP server's canonical URI** for
  that client, and sign with RS256/ES256.
- The MCP server (resource server) verifies the bearer token against Supabase's JWKS endpoint and
  asserts `aud === <its own canonical URI>` and `iss === <supabase issuer>`.
- Pro: one identity system, one JWKS, RLS keeps working downstream, least new infra.
- Con: **not strictly RFC 8707** — `aud` is per-client, not driven by the request's `resource`
  parameter. Fine while we have exactly one MCP resource. Breaks down if one client must obtain
  distinct tokens for several resources in a session (the exact case 8707 exists for). Also relies
  on the OAuth-server + access-token-hook beta surface.

### Path B — Cloudflare `workers-oauth-provider` as a dedicated MCP authorization server

- The Worker is the OAuth 2.1 AS for the MCP server; it implements **RFC 8707 resource indicators**,
  RFC 8414 (AS metadata), RFC 9728 (protected-resource metadata), and RFC 7591 (dynamic client
  registration) — i.e. the full set the MCP spec demands.
- It **wraps an upstream IdP** (it can federate to Supabase / Google / WorkOS / Auth0). The user
  authenticates upstream; the Worker then mints **its own** MCP-scoped token with `aud` bound to the
  requested resource's canonical URI.
- The MCP server validates tokens the Worker issued (its own JWKS / shared key inside the Worker).
- Pro: spec-complete RFC 8707, purpose-built for MCP, handles multi-resource and token mis-redemption
  correctly, future-proof as we add more MCP resources/tools.
- Con: a second auth system to operate and key-manage; identity is now federated (Worker token, not
  the Supabase token) so the edge functions / DB must trust the Worker's token, mapping its `sub`
  back to a Supabase `auth.users.id` for RLS.

## Recommendation for `v1a` (and the trigger to revisit)

**Adopt Path A now; keep Path B as the documented escape hatch.**

For v1a we have **exactly one MCP resource server** and one tool surface (`report_evidence` +
`get_inbox`). Lean-first (per CLAUDE.md) says do not stand up a second OAuth authorization server
for a single resource. Path A gets us:

- a JWKS-verifiable, asymmetrically-signed token,
- a fixed, checkable `aud` equal to the MCP server's canonical URI,
- one identity system, so the edge `ingest` function and DB RLS keep resolving `auth.uid()` with no
  token translation.

The MCP server still does the security-relevant checks the spec cares about — **verify signature via
JWKS, assert `iss`, assert `aud === own canonical URI`, reject otherwise** — so it is hardened against
token replay *to it*. What we consciously defer is request-driven `resource`-parameter binding.

**Escalate to Path B (workers-oauth-provider) when any of these becomes true:**

1. A second MCP resource server / distinct tool audience appears (one token must not be valid at both).
2. We must pass formal MCP-spec conformance / enterprise review that checks the AS echoes the
   `resource` parameter and advertises RFC 8707 + RFC 9728 metadata.
3. We onboard third-party MCP clients we do not control (confused-deputy surface widens).

### Concrete asks for the `v1a/mcp` worktree

- Treat the MCP server as an **OAuth 2.0 protected resource**. Decide and pin its **canonical URI**
  (RFC 8707 §2) — that string is the `aud` everyone agrees on.
- Verify bearer tokens via the **Supabase JWKS** endpoint (RS256/ES256), and hard-assert
  `aud === <canonical URI>` and `iss === <supabase issuer>`. Do not accept `aud: "authenticated"`.
- Serve **OAuth Protected Resource Metadata (RFC 9728)** at
  `/.well-known/oauth-protected-resource` pointing at the Supabase AS, so spec-compliant MCP clients
  can discover the AS and send the `resource` parameter even though (under Path A) Supabase ignores it.
- Leave a `// TODO(v1a-live)` seam to swap the issuer/JWKS from Supabase to a Cloudflare
  `workers-oauth-provider` Worker if/when a Path-B trigger fires — keep verification config (issuer,
  JWKS URL, expected `aud`) in one place so the swap is a config change, not a rewrite.

### Data-layer implication (this worktree)

`SupabaseAimcubRepo` is unaffected by the choice: it consumes an *already-authenticated* user
client (RLS-bound) + a service_role client. The token's `aud`/`iss` are validated **before** any
repo call (at the MCP server / edge function boundary). The only live seam on our side is wiring the
verified user's access token into the user Supabase client so RLS sees the right `auth.uid()` — see
`// TODO(v1a-live)` in `packages/api/src/supabase.ts`.

## Sources

- Supabase — Getting Started with OAuth 2.1 Server: https://supabase.com/docs/guides/auth/oauth-server/getting-started
- Supabase — Token Security and Row Level Security: https://supabase.com/docs/guides/auth/oauth-server/token-security
- Supabase — Custom Access Token Hook: https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook
- Supabase — JWT Claims Reference (aud / role defaults): https://supabase.com/docs/guides/auth/jwt-fields
- MCP — Authorization spec (2025-11-25): https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- Cloudflare Agents — MCP Authorization (workers-oauth-provider): https://developers.cloudflare.com/agents/model-context-protocol/authorization/
- cloudflare/workers-oauth-provider: https://github.com/cloudflare/workers-oauth-provider
- RFC 8707 — Resource Indicators for OAuth 2.0: https://www.rfc-editor.org/rfc/rfc8707.html
- WorkOS — RFC 8707 guide: https://workos.com/blog/oauth-resource-indicators-rfc-8707
