# Security Policy

## Reporting a Vulnerability

Please report suspected security vulnerabilities privately using [GitHub
Security Advisories](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability)
for this repository ("Security" tab → "Report a vulnerability"), rather than
opening a public issue.

> **Note for maintainers:** private vulnerability reporting must be enabled in
> the repository settings before this repo goes public. Until then, treat this
> section as the intended process rather than a confirmed-live channel.

Please do not disclose potential vulnerabilities publicly until they have been
reviewed and addressed.

## Supported Versions

Aimcub is pre-release. Only the `main` branch is supported; there are no
maintained release branches or version tags yet.

## Key Handling

Aimcub is a local-first agent harness plus a small hosted MCP evidence spine.
Provider API keys and hosted secrets are never committed to this repository:

- **Provider keys (Desktop/CLI, local).** Keys for LLM providers are resolved
  from environment variables (e.g. `AIMCUB_API_KEY`, `ANTHROPIC_API_KEY`,
  `OPENAI_API_KEY`, and the other per-provider variables listed in
  [`apps/cli/src/config.ts`](apps/cli/src/config.ts)) or from local settings
  files under the Aimcub data directory (`$AIMCUB_HOME`, or `~/.aimcub` by
  default): `settings.json`, `web-settings.json`, and `context-sources.json`.
  These files are written with owner-only permissions (mode `0600`).
- **Hosted secrets (MCP worker).** The Cloudflare Worker in `apps/mcp` keeps
  `SUPABASE_SERVICE_ROLE_KEY` as a Wrangler secret (`wrangler secret put
  SUPABASE_SERVICE_ROLE_KEY`), never in `wrangler.toml` or any other committed
  file. Non-secret configuration, such as the Supabase project URL, is a
  public identifier and may appear in `wrangler.toml`.

If you believe a key or credential has been committed to this repository,
please report it through GitHub Security Advisories rather than opening a
public issue, so it can be rotated before disclosure.

## Scope

This policy covers the local Desktop/CLI application in this repository and
the hosted MCP worker (`apps/mcp`). It does not cover third-party LLM provider
services that users configure Aimcub to call.
