import { beforeAll, describe, expect, it } from "vitest";
import { AuthError, bearerFromHeader, verifyAccessToken } from "./auth";
import { makeTestSigner } from "./test-helpers";

const RESOURCE = "https://mcp.aimcub.com";
const ISSUER = "https://auth.aimcub.com";

/**
 * Pay for the RSA keypairs in a hook rather than inside whichever test happens to run first.
 * `makeTestSigner` generates them once and caches them, but that one generation still has a
 * multi-second tail — and a hook gets vitest's 10s budget instead of a test's 5s one.
 */
beforeAll(async () => {
  await makeTestSigner();
});

describe("verifyAccessToken", () => {
  it("accepts a token with a valid signature and the correct audience", async () => {
    const signer = await makeTestSigner();
    const token = await signer.sign({ aud: RESOURCE, sub: "agent-42", iss: ISSUER, scope: "evidence:write" });

    const ctx = await verifyAccessToken(token, { jwks: signer.jwks, resource: RESOURCE, issuer: ISSUER });

    expect(ctx.subject).toBe("agent-42");
    expect(ctx.scopes).toContain("evidence:write");
    expect(ctx.claims.aud).toBe(RESOURCE);
  });

  it("accepts when the resource is one of several audiences", async () => {
    const signer = await makeTestSigner();
    const token = await signer.sign({ aud: ["https://other.example", RESOURCE] });
    const ctx = await verifyAccessToken(token, { jwks: signer.jwks, resource: RESOURCE });
    expect(ctx.claims.aud).toEqual(["https://other.example", RESOURCE]);
  });

  it("rejects a token whose audience does not match this resource", async () => {
    const signer = await makeTestSigner();
    const token = await signer.sign({ aud: "https://someone-elses-api.example" });

    await expect(verifyAccessToken(token, { jwks: signer.jwks, resource: RESOURCE })).rejects.toMatchObject({
      code: "invalid_audience",
    });
  });

  it("rejects a token whose signature does not verify against the JWKS", async () => {
    const signer = await makeTestSigner();
    const token = await signer.sign({ aud: RESOURCE });

    // Verify against a DIFFERENT key set (same kid, wrong key) → signature fails.
    await expect(verifyAccessToken(token, { jwks: signer.otherJwks, resource: RESOURCE })).rejects.toMatchObject({
      code: "invalid_token",
    });
  });

  it("rejects a tampered token", async () => {
    const signer = await makeTestSigner();
    const token = await signer.sign({ aud: RESOURCE });
    const tampered = token.slice(0, -3) + "AAA";

    await expect(verifyAccessToken(tampered, { jwks: signer.jwks, resource: RESOURCE })).rejects.toBeInstanceOf(
      AuthError,
    );
  });

  it("rejects an expired token", async () => {
    const signer = await makeTestSigner();
    const token = await signer.sign({ aud: RESOURCE, expiresIn: "-1m" });

    await expect(verifyAccessToken(token, { jwks: signer.jwks, resource: RESOURCE })).rejects.toMatchObject({
      code: "invalid_token",
    });
  });

  it("rejects a token from an unexpected issuer when an issuer is configured", async () => {
    const signer = await makeTestSigner();
    const token = await signer.sign({ aud: RESOURCE, iss: "https://evil.example" });

    await expect(
      verifyAccessToken(token, { jwks: signer.jwks, resource: RESOURCE, issuer: ISSUER }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects a missing token", async () => {
    const signer = await makeTestSigner();
    await expect(verifyAccessToken(undefined, { jwks: signer.jwks, resource: RESOURCE })).rejects.toMatchObject({
      code: "missing_token",
    });
  });

  it("rejects a malformed (non-JWT) token", async () => {
    const signer = await makeTestSigner();
    await expect(verifyAccessToken("not-a-jwt", { jwks: signer.jwks, resource: RESOURCE })).rejects.toBeInstanceOf(
      AuthError,
    );
  });
});

describe("bearerFromHeader", () => {
  it("extracts the token from a Bearer header (case-insensitive)", () => {
    expect(bearerFromHeader("Bearer abc.def.ghi")).toBe("abc.def.ghi");
    expect(bearerFromHeader("bearer xyz")).toBe("xyz");
  });

  it("returns undefined for missing or non-bearer headers", () => {
    expect(bearerFromHeader(undefined)).toBeUndefined();
    expect(bearerFromHeader("Basic abc")).toBeUndefined();
  });
});
