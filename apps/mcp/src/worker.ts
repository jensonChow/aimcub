/**
 * Cloudflare Workers shell for aimcub-mcp (Streamable HTTP, stateless).
 *
 * Routes:
 *   GET  /health                                  — open liveness probe
 *   GET  /.well-known/oauth-protected-resource    — RFC 9728 metadata pointing at the AS
 *   POST /mcp                                     — bearer-gated MCP endpoint
 *
 * The Worker is a pure OAuth 2.1 resource server (see AUTH_FINDINGS.md, Path A):
 * it verifies the JWT signature against the authorization server's JWKS and
 * hard-asserts `aud === MCP_RESOURCE_URI` and `iss === OAUTH_ISSUER`. The token
 * is never forwarded downstream. The MCP SDK's Node transport is bridged to the
 * Workers fetch API via `fetch-to-node` (requires the `nodejs_compat` flag).
 */
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { toReqRes, toFetchResponse } from "fetch-to-node";
import {
  AuthError,
  bearerFromHeader,
  createRemoteJwksResolver,
  verifyAccessToken,
  type JWKSResolver,
} from "./auth.js";
import type { ToolDeps } from "./ports.js";
import { buildServer } from "./server.js";
import { placeholderIngest, placeholderRepo } from "./placeholders.js";

export interface Env {
  /** Canonical resource URI of this MCP server — the `aud` everyone agrees on. */
  MCP_RESOURCE_URI?: string;
  /** Expected token issuer (the Supabase authorization server). */
  OAUTH_ISSUER?: string;
  /** JWKS endpoint; defaults to `${OAUTH_ISSUER}/.well-known/jwks.json`. */
  OAUTH_JWKS_URI?: string;
}

interface ResolvedConfig {
  resource: string;
  issuer?: string;
  jwksUri: string;
}

export function resolveConfig(env: Env): ResolvedConfig {
  const resource = env.MCP_RESOURCE_URI ?? "https://mcp.aimcub.com";
  const issuer = env.OAUTH_ISSUER;
  const jwksUri =
    env.OAUTH_JWKS_URI ?? (issuer ? `${issuer.replace(/\/$/, "")}/.well-known/jwks.json` : "");
  return { resource, issuer, jwksUri };
}

/** RFC 9728 Protected Resource Metadata: lets spec-compliant MCP clients discover the AS. */
export function protectedResourceMetadata(resource: string, issuer: string | undefined) {
  return {
    resource,
    authorization_servers: issuer ? [issuer] : [],
    bearer_methods_supported: ["header"],
    resource_documentation: "https://github.com/jensonChow/aimcub",
  };
}

/** RFC 6750 challenge value, with the RFC 9728 metadata pointer MCP clients follow on 401. */
export function wwwAuthenticateValue(err: AuthError, resource: string): string {
  const code = err.code === "missing_token" ? "invalid_request" : "invalid_token";
  const metadataUrl = `${resource.replace(/\/$/, "")}/.well-known/oauth-protected-resource`;
  return (
    `Bearer error="${code}", error_description="${err.message.replaceAll('"', "'")}", ` +
    `resource_metadata="${metadataUrl}"`
  );
}

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id",
  "access-control-expose-headers": "mcp-session-id, www-authenticate",
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS, ...headers },
  });
}

// Lazy JWKS resolver, cached per isolate (jose's createRemoteJWKSet caches keys + cooldown).
let jwksCache: { uri: string; resolver: JWKSResolver } | undefined;
async function jwksFor(uri: string): Promise<JWKSResolver> {
  if (!jwksCache || jwksCache.uri !== uri) {
    jwksCache = { uri, resolver: await createRemoteJwksResolver(uri) };
  }
  return jwksCache.resolver;
}

/** TODO(v1a-live): swap placeholders for the service-role SupabaseAimcubRepo + ingest adapter. */
function productionDeps(): ToolDeps {
  return { repo: placeholderRepo, ingest: placeholderIngest };
}

async function handleMcpPost(request: Request, config: ResolvedConfig): Promise<Response> {
  // ── OAuth 2.1 resource-server gate ────────────────────────────────────────
  try {
    const jwks = await jwksFor(config.jwksUri);
    await verifyAccessToken(bearerFromHeader(request.headers.get("authorization") ?? undefined), {
      jwks,
      resource: config.resource,
      issuer: config.issuer,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return json(
        { error: err.code, error_description: err.message },
        err.status,
        { "www-authenticate": wwwAuthenticateValue(err, config.resource) },
      );
    }
    throw err;
  }

  // ── Streamable HTTP, stateless: fresh server+transport per request ────────
  // Parse from a clone so toReqRes still sees an unconsumed body stream.
  const body: unknown = await request.clone().json();
  const { req, res } = toReqRes(request);
  const server = buildServer(productionDeps());
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
  const response = await toFetchResponse(res);
  // Re-issue with CORS headers (toFetchResponse yields an immutable header set).
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const config = resolveConfig(env);
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true });
    }
    if (request.method === "GET" && url.pathname === "/.well-known/oauth-protected-resource") {
      return json(protectedResourceMetadata(config.resource, config.issuer));
    }
    if (url.pathname === "/mcp") {
      if (request.method !== "POST") {
        // Stateless server: no SSE resume stream (GET) and no session delete (DELETE).
        return json({ error: "method_not_allowed" }, 405, { allow: "POST" });
      }
      return handleMcpPost(request, config);
    }
    return json({ error: "not_found" }, 404);
  },
};
