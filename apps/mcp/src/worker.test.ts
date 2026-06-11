import { describe, expect, it } from "vitest";
import { AuthError, type AuthContext } from "./auth";
import worker, {
  identityFromAuth,
  productionDeps,
  protectedResourceMetadata,
  resolveConfig,
  wwwAuthenticateValue,
} from "./worker";

describe("resolveConfig", () => {
  it("derives the JWKS URI from the issuer when not set explicitly", () => {
    const config = resolveConfig({ OAUTH_ISSUER: "https://ref.supabase.co/auth/v1" });
    expect(config.jwksUri).toBe("https://ref.supabase.co/auth/v1/.well-known/jwks.json");
    expect(config.resource).toBe("https://mcp.aimcub.com");
  });

  it("prefers explicit env values", () => {
    const config = resolveConfig({
      MCP_RESOURCE_URI: "https://mcp.example.com",
      OAUTH_ISSUER: "https://as.example.com",
      OAUTH_JWKS_URI: "https://as.example.com/keys",
    });
    expect(config).toEqual({
      resource: "https://mcp.example.com",
      issuer: "https://as.example.com",
      jwksUri: "https://as.example.com/keys",
    });
  });
});

describe("protectedResourceMetadata (RFC 9728)", () => {
  it("advertises the resource and its authorization server", () => {
    const meta = protectedResourceMetadata("https://mcp.aimcub.com", "https://ref.supabase.co/auth/v1");
    expect(meta.resource).toBe("https://mcp.aimcub.com");
    expect(meta.authorization_servers).toEqual(["https://ref.supabase.co/auth/v1"]);
    expect(meta.bearer_methods_supported).toEqual(["header"]);
  });

  it("returns an empty AS list when the issuer is not configured", () => {
    expect(protectedResourceMetadata("https://mcp.aimcub.com", undefined).authorization_servers).toEqual([]);
  });
});

describe("wwwAuthenticateValue (RFC 6750 + 9728)", () => {
  it("maps a missing token to invalid_request and points at the resource metadata", () => {
    const value = wwwAuthenticateValue(
      new AuthError("missing_token", "missing bearer token"),
      "https://mcp.aimcub.com",
    );
    expect(value).toContain('error="invalid_request"');
    expect(value).toContain('resource_metadata="https://mcp.aimcub.com/.well-known/oauth-protected-resource"');
  });

  it("maps verification failures to invalid_token and strips double quotes from the detail", () => {
    const value = wwwAuthenticateValue(
      new AuthError("invalid_audience", 'token audience "x" does not match'),
      "https://mcp.aimcub.com",
    );
    expect(value).toContain('error="invalid_token"');
    expect(value).not.toContain('""');
  });
});

describe("identityFromAuth (verified token → caller identity)", () => {
  const auth = (subject: string): AuthContext => ({ subject, claims: { sub: subject }, scopes: [] });
  const USER = "11111111-1111-4111-8111-111111111111";

  it("derives ownerId from the verified subject claim", () => {
    expect(identityFromAuth(auth(USER))).toEqual({ ownerId: USER });
  });

  it("rejects a subject-less token with a 401 AuthError", () => {
    expect(() => identityFromAuth(auth(""))).toThrowError(AuthError);
    try {
      identityFromAuth(auth(""));
    } catch (err) {
      expect((err as AuthError).code).toBe("invalid_token");
      expect((err as AuthError).status).toBe(401);
    }
  });

  it("rejects a non-UUID subject with a 401 AuthError — ownerId must be an auth.users id", () => {
    for (const sub of ["user-123", "service@example.com", `${USER} `, `${USER}x`]) {
      expect(() => identityFromAuth(auth(sub)), `sub: ${sub}`).toThrowError(AuthError);
    }
    try {
      identityFromAuth(auth("user-123"));
    } catch (err) {
      expect((err as AuthError).code).toBe("invalid_token");
      expect((err as AuthError).status).toBe(401);
    }
  });
});

describe("productionDeps (live Supabase wiring from env)", () => {
  it("fails loudly when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are missing", () => {
    expect(() => productionDeps({})).toThrow(/SUPABASE_URL/);
    expect(() => productionDeps({ SUPABASE_URL: "https://x.supabase.co" })).toThrow(
      /SUPABASE_SERVICE_ROLE_KEY/,
    );
    expect(() => productionDeps({ SUPABASE_SERVICE_ROLE_KEY: "k" })).toThrow(/wrangler secret put/);
  });

  it("builds the live deps and caches them per isolate (same url → same instance)", () => {
    const env = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key" };
    const first = productionDeps(env);
    expect(typeof first.repo.getGoal).toBe("function");
    expect(typeof first.ingest.ingest).toBe("function");
    expect(productionDeps(env)).toBe(first);
  });
});

describe("fetch handler — top-level error hygiene", () => {
  const mcpPost = (headers: Record<string, string>, body = "{}") =>
    new Request("https://mcp.aimcub.com/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    });

  it("turns throwing deps (Supabase env unset) into an opaque 500 JSON, never a raw exception page", async () => {
    // productionDeps throws before the auth gate; the wrapper must answer
    // {"error":"internal_error"} with CORS intact — not Cloudflare's 1101 page.
    const res = await worker.fetch(
      mcpPost({ authorization: "Bearer t" }),
      { OAUTH_ISSUER: "https://as.example.com" }, // no SUPABASE_URL / key
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal_error" });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("content-type")).toBe("application/json");
  });

  it("rejects an oversized Content-Length with a 413 JSON error before parsing", async () => {
    const res = await worker.fetch(
      mcpPost({ "content-length": String(256 * 1024 + 1), authorization: "Bearer t" }),
      { OAUTH_ISSUER: "https://as.example.com" },
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "payload_too_large" });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
