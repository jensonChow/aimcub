/**
 * goalpet-mcp — public-facing MCP server (Streamable HTTP).
 *
 * v1a: an OAuth 2.1 resource server (verifies the access token's signature +
 * audience, never forwards the token) in front of port-driven tools:
 *   - ping / pet_stage_preview  (v0, prove @core is shared with web)
 *   - report_evidence           (agent reports progress → normalized evidence → ingest port)
 *   - goal_status / list_milestones (read milestones via the repo port)
 *   - get_inbox                 (stub; v1b)
 *
 * All external I/O sits behind injected ports so the tool layer is mockable; the
 * production adapters are placeholders marked `// TODO(v1a-live)`.
 */
import express, { type Request, type Response, type NextFunction } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { stageForXp } from "@core/domain";
import {
  AuthError,
  bearerFromHeader,
  createRemoteJwksResolver,
  verifyAccessToken,
  type AuthContext,
  type JWKSResolver,
} from "./auth.js";
import type { ToolDeps } from "./ports.js";
import { registerGoalPetTools } from "./tools.js";
import { placeholderIngest, placeholderRepo } from "./placeholders.js";

/** Build a fully-wired MCP server from injected dependencies. */
export function buildServer(deps: ToolDeps): McpServer {
  const server = new McpServer({ name: "goalpet-mcp", version: "0.1.0" });

  server.registerTool(
    "ping",
    { description: "Health check. Returns 'pong'." },
    async () => ({ content: [{ type: "text", text: "pong" }] }),
  );

  server.registerTool(
    "pet_stage_preview",
    {
      description: "Preview which pet stage a given XP maps to. Proves @core/domain is shared with web.",
      inputSchema: { xp: z.number().int().nonnegative() },
    },
    async ({ xp }) => ({
      content: [{ type: "text", text: `xp=${xp} → stage=${stageForXp(xp)}` }],
    }),
  );

  registerGoalPetTools(server, deps);
  return server;
}

/**
 * Express middleware that enforces the OAuth 2.1 resource-server check. On
 * success it attaches the derived {@link AuthContext} to `res.locals.auth`; on
 * failure it returns 401 with a `WWW-Authenticate` challenge.
 */
export function makeAuthMiddleware(opts: { jwks: JWKSResolver; resource: string; issuer?: string }) {
  return async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const token = bearerFromHeader(req.header("authorization"));
      const auth = await verifyAccessToken(token, {
        jwks: opts.jwks,
        resource: opts.resource,
        issuer: opts.issuer,
      });
      (res.locals as { auth?: AuthContext }).auth = auth;
      next();
    } catch (err) {
      if (err instanceof AuthError) {
        // RFC 6750 / RFC 9728: advertise the resource so the client can discover
        // the right authorization server. TODO(v1a-live): add resource_metadata URL.
        res.setHeader(
          "WWW-Authenticate",
          `Bearer error="${err.code === "missing_token" ? "invalid_request" : "invalid_token"}", ` +
            `error_description="${err.message}", resource="${opts.resource}"`,
        );
        res.status(err.status).json({ error: err.code, error_description: err.message });
        return;
      }
      next(err);
    }
  };
}

/* c8 ignore start -- bootstrap: exercised only when the process runs, not in unit tests */

/** Wire the production server (placeholder adapters until the live ones land). */
function productionDeps(): ToolDeps {
  return { repo: placeholderRepo, ingest: placeholderIngest };
}

async function main(): Promise<void> {
  const resource = process.env.MCP_RESOURCE_URI ?? "https://mcp.goalpet.app";
  const issuer = process.env.OAUTH_ISSUER;
  const jwksUri = process.env.OAUTH_JWKS_URI ?? "https://auth.goalpet.app/.well-known/jwks.json";

  // TODO(v1a-live): build the resolver from the real authorization server discovery doc.
  const jwks = await createRemoteJwksResolver(jwksUri);
  const deps = productionDeps();

  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Auth-gate the MCP endpoint only (health stays open for probes).
  app.use("/mcp", makeAuthMiddleware({ jwks, resource, issuer }));

  // Streamable HTTP, single endpoint /mcp. Stateless: fresh server+transport per request.
  app.post("/mcp", async (req, res) => {
    const server = buildServer(deps);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const port = Number(process.env.PORT ?? 8787);
  app.listen(port, () => {
    console.log(`goalpet-mcp listening on :${port}/mcp`);
  });
}

// Only auto-start when executed directly (so importing this module in tests is side-effect-free).
const isEntrypoint = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isEntrypoint) {
  void main();
}

/* c8 ignore stop */
