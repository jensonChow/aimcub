/**
 * Test-only helpers (real crypto, no network). Builds local JWKS resolvers over real RS256
 * keypairs and signs genuine JWTs, so the auth tests exercise real signature verification
 * rather than mocking it. The keypairs are generated once per process and shared — see
 * {@link testKeys} for why that matters.
 *
 * Imported only from *.test.ts; not part of the shipped server surface.
 */
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet, type JSONWebKeySet } from "jose";
import type { JWKSResolver } from "./auth.js";

const ALG = "RS256";
const KID = "test-key-1";

type GeneratedKeyPair = Awaited<ReturnType<typeof generateKeyPair>>;

interface TestKeys {
  privateKey: GeneratedKeyPair["privateKey"];
  jwks: JWKSResolver;
  otherJwks: JWKSResolver;
}

/**
 * The keypairs, generated ONCE per process.
 *
 * RSA-2048 generation is a probabilistic prime search, so its cost is wide and load-sensitive:
 * measured on this machine it runs a ~1.0s median but a ~3.2s p90 even on an idle box. A signer
 * needs two of them, and every test used to build its own — 18 keygens, ~25s of pure crypto, with
 * each test's pair racing vitest's 5s default timeout. That is why these tests failed
 * intermittently in a loaded parallel run (two adjacent ones timing out at ~5003ms/5031ms) while
 * passing in isolation; it was never a clock/expiry problem.
 *
 * Sharing is safe: the keys are immutable and nothing here mutates the signer. Callers still get
 * their own `TestSigner` object, and `otherJwks` is still a genuinely different keypair.
 */
let keysPromise: Promise<TestKeys> | null = null;

function testKeys(): Promise<TestKeys> {
  // One shared promise, so concurrent callers wait on a single generation rather than racing.
  keysPromise ??= (async (): Promise<TestKeys> => {
    // Generated CONCURRENTLY: two independent searches on the crypto threadpool cost one
    // wall-clock slot instead of two.
    const [real, other] = await Promise.all([
      generateKeyPair(ALG, { extractable: true }),
      generateKeyPair(ALG, { extractable: true }),
    ]);
    const publicJwk = { ...(await exportJWK(real.publicKey)), kid: KID, alg: ALG, use: "sig" };
    // A second, unrelated keypair published under the SAME kid — so a token signed by the real
    // private key is structurally resolvable but fails the signature check.
    const otherJwk = { ...(await exportJWK(other.publicKey)), kid: KID, alg: ALG, use: "sig" };
    return {
      privateKey: real.privateKey,
      jwks: createLocalJWKSet({ keys: [publicJwk] } satisfies JSONWebKeySet),
      otherJwks: createLocalJWKSet({ keys: [otherJwk] } satisfies JSONWebKeySet),
    };
  })();
  return keysPromise;
}

export interface TestSigner {
  /** Resolver that recognizes the real public key (pass as deps.jwks). */
  jwks: JWKSResolver;
  /** A resolver from a DIFFERENT keypair — used to force signature-mismatch failures. */
  otherJwks: JWKSResolver;
  /** Sign a JWT with the real private key. */
  sign(claims: { aud: string | string[]; sub?: string; iss?: string; expiresIn?: string; scope?: string }): Promise<string>;
}

export async function makeTestSigner(): Promise<TestSigner> {
  const { privateKey, jwks, otherJwks } = await testKeys();

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
