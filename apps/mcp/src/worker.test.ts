import { describe, expect, it } from "vitest";
import { AuthError } from "./auth";
import { protectedResourceMetadata, resolveConfig, wwwAuthenticateValue } from "./worker";

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
