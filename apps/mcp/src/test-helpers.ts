/**
 * Test-only helpers (real crypto, no network). Generates an RS256 keypair, builds
 * a local JWKS resolver, and signs genuine JWTs so the auth tests exercise real
 * signature verification rather than mocking it.
 *
 * Imported only from *.test.ts; not part of the shipped server surface.
 */
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet, type JSONWebKeySet } from "jose";
import type { JWKSResolver } from "./auth.js";

const ALG = "RS256";
const KID = "test-key-1";

export interface TestSigner {
  /** Resolver that recognizes the real public key (pass as deps.jwks). */
  jwks: JWKSResolver;
  /** A resolver from a DIFFERENT keypair — used to force signature-mismatch failures. */
  otherJwks: JWKSResolver;
  /** Sign a JWT with the real private key. */
  sign(claims: { aud: string | string[]; sub?: string; iss?: string; expiresIn?: string; scope?: string }): Promise<string>;
}

export async function makeTestSigner(): Promise<TestSigner> {
  const { privateKey, publicKey } = await generateKeyPair(ALG, { extractable: true });
  const publicJwk = { ...(await exportJWK(publicKey)), kid: KID, alg: ALG, use: "sig" };
  const jwksDoc: JSONWebKeySet = { keys: [publicJwk] };
  const jwks = createLocalJWKSet(jwksDoc);

  // A second, unrelated keypair whose JWKS is published under the SAME kid — so a
  // token signed by `privateKey` is structurally resolvable but fails the signature.
  const other = await generateKeyPair(ALG, { extractable: true });
  const otherJwk = { ...(await exportJWK(other.publicKey)), kid: KID, alg: ALG, use: "sig" };
  const otherJwks = createLocalJWKSet({ keys: [otherJwk] } satisfies JSONWebKeySet);

  return {
    jwks,
    otherJwks,
    async sign(claims) {
      let jwt = new SignJWT({ scope: claims.scope })
        .setProtectedHeader({ alg: ALG, kid: KID })
        .setIssuedAt()
        .setSubject(claims.sub ?? "user-123")
        .setAudience(claims.aud)
        .setExpirationTime(claims.expiresIn ?? "5m");
      if (claims.iss) jwt = jwt.setIssuer(claims.iss);
      return jwt.sign(privateKey);
    },
  };
}
