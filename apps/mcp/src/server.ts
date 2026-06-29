/**
 * aimcub-mcp — MCP server assembly (transport-agnostic).
 *
 * v1a: the deployable shell is a Cloudflare Worker (`worker.ts`) acting as an
 * OAuth 2.1 resource server (verifies the access token's signature + audience,
 * never forwards the token) in front of port-driven tools:
 *   - ping                      (health check)
 *   - report_evidence           (agent reports progress → normalized evidence → ingest port)
 *   - goal_status / list_milestones (read milestones via the repo port)
 *
 * All external I/O sits behind injected ports so the tool layer is mockable; the
 * production adapters live in `supabase-deps.ts` (service-role supabase-js), and
 * the caller identity is the verified OAuth token subject threaded via ToolDeps.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDeps } from "./ports.js";
import { registerAimcubTools } from "./tools.js";

/** Build a fully-wired MCP server from injected dependencies. */
export function buildServer(deps: ToolDeps): McpServer {
  const server = new McpServer({ name: "aimcub-mcp", version: "0.1.0" });

  server.registerTool(
    "ping",
    { description: "Health check. Returns 'pong'." },
    async () => ({ content: [{ type: "text", text: "pong" }] }),
  );

  registerAimcubTools(server, deps);
  return server;
}
