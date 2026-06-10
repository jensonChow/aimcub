/**
 * OAuth 2.1 resource-server verification for the Aimcub MCP server.
 *
 * The MCP server is a pure RESOURCE SERVER (RFC 6749 / RFC 9728 / the MCP auth
 * profile): it receives a bearer access token from the agent, verifies the JWT
 * signature against the authorization server's JWKS, and checks that the token's
 * `aud` (audience) names *this* MCP resource. It NEVER forwards the token to any
 * downstream service — it only derives a trusted identity (`AuthContext`) from
 * the verified claims.
 *
 * The JWKS key resolver is INJECTED (`JWKSResolver`). In production it is a
 * remote JWKS set; in tests it is a local key set built from a generated keypair,
 * so signature verification is exercised for real without any network.
 */
import { jwtVerify } from "jose";
import type { JWTPayload, JWTVerifyGetKey, JSONWebKeySet } from "jose";

/**
 * A jose key-resolution function: given the JWS protected header it returns the
 * public key to verify against. `createLocalJWKSet(jwks)` and
 * `createRemoteJWKSet(url)` both produce a value assignable to this type.
 */
export type JWKSResolver = JWTVerifyGetKey;

export interface VerifierConfig {
  /**
   * The canonical identifier of this MCP resource server (its resource URI).
   * A token is accepted only if its `aud` claim contains this value.
   */
  resource: string;
  /** Expected token issuer (the authorization server). Optional but recommended. */
  issuer?: string;
  /** Accepted signature algorithms. Defaults to asymmetric algorithms only. */
  algorithms?: string[];
}

export interface VerifyDeps extends VerifierConfig {
  /** Injected JWKS key resolver (fake local set in tests, remote set in prod). */
  jwks: JWKSResolver;
}

/** Identity derived from a verified access token. Never contains the raw token. */
export interface AuthContext {
  /** `sub` claim — the authenticated principal (a user or an agent emitter). */
  subject: string;
  /** Full set of verified claims, for tools that need scopes / custom claims. */
  claims: JWTPayload;
  /** Scopes parsed from the space-delimited `scope` claim (RFC 8693), if any. */
  scopes: string[];
}

export type AuthErrorCode =
  | "missing_token"
  | "invalid_token"
  | "invalid_audience"
  | "invalid_issuer";

/** Verification failure. Mirrors the OAuth 2.1 `WWW-Authenticate` error vocabulary. */
export class AuthError extends Error {
  readonly code: AuthErrorCode;
  /** HTTP status to surface (401 for auth failures). */
  readonly status: number;
  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.status = 401;
  }
}

const DEFAULT_ALGORITHMS = ["RS256", "RS384", "RS512", "ES256", "ES384", "PS256"];

function audienceMatches(aud: JWTPayload["aud"], resource: string): boolean {
  if (typeof aud === "string") return aud === resource;
  if (Array.isArray(aud)) return aud.includes(resource);
  return false;
}

function parseScopes(claims: JWTPayload): string[] {
  const raw = claims.scope ?? (claims as Record<string, unknown>).scp;
  if (typeof raw === "string") return raw.split(" ").filter(Boolean);
  if (Array.isArray(raw)) return raw.filter((s): s is string => typeof s === "string");
  return [];
}

/**
 * Verify a bearer access token. Resolves to an {@link AuthContext} on success and
 * throws {@link AuthError} on any failure (bad signature, wrong audience, wrong
 * issuer, expired, malformed). The JWKS resolver is injected via `deps.jwks`.
 */
export async function verifyAccessToken(
  token: string | undefined | null,
  deps: VerifyDeps,
): Promise<AuthContext> {
  if (!token || token.trim() === "") {
    throw new AuthError("missing_token", "missing bearer token");
  }

  let payload: JWTPayload;
  try {
    // jose validates the JWS signature against the resolved key AND the temporal
    // claims (exp / nbf) and (when provided) the issuer. We additionally enforce
    // the audience ourselves so we can return a precise error code.
    const result = await jwtVerify(token, deps.jwks, {
      algorithms: deps.algorithms ?? DEFAULT_ALGORITHMS,
      issuer: deps.issuer,
    });
    payload = result.payload;
  } catch (err) {
    // Signature mismatch, expired, malformed JWT, unknown kid, etc.
    const reason = err instanceof Error ? err.message : "verification failed";
    // jose distinguishes issuer-claim failures; surface them as invalid_issuer.
    if (reason.toLowerCase().includes("iss")) {
      throw new AuthError("invalid_issuer", `token issuer rejected: ${reason}`);
    }
    throw new AuthError("invalid_token", `token verification failed: ${reason}`);
  }

  if (!audienceMatches(payload.aud, deps.resource)) {
    throw new AuthError(
      "invalid_audience",
      `token audience ${JSON.stringify(payload.aud)} does not match resource ${deps.resource}`,
    );
  }

  return {
    subject: payload.sub ?? "",
    claims: payload,
    scopes: parseScopes(payload),
  };
}

/** Extract the bearer token from an HTTP `Authorization` header value. */
export function bearerFromHeader(authorization: string | undefined): string | undefined {
  if (!authorization) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1];
}

/**
 * Build the production JWKS resolver from a remote authorization-server JWKS URL.
 *
 * NOTE: `createRemoteJWKSet` performs network I/O (it lazily fetches + caches the
 * JWKS). It is intentionally NOT imported at module top level so the rest of the
 * module — and the tests — stay network-free.
 */
export async function createRemoteJwksResolver(jwksUri: string): Promise<JWKSResolver> {
  // TODO(v1a-live): point at the real authorization server's JWKS URI (from env,
  // e.g. `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` or the IdP discovery doc)
  // and verify TLS / caching headers. This dynamic import keeps the network-touching
  // jose subpath out of the resource-server hot path until live wiring.
  const { createRemoteJWKSet } = await import("jose");
  return createRemoteJWKSet(new URL(jwksUri));
}

/** Build a network-free JWKS resolver from a static key set (tests + air-gapped). */
export async function createLocalJwksResolver(jwks: JSONWebKeySet): Promise<JWKSResolver> {
  const { createLocalJWKSet } = await import("jose");
  return createLocalJWKSet(jwks);
}
