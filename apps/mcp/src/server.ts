/**
 * aimcub-mcp — MCP server assembly (transport-agnostic).
 *
 * v1a: the deployable shell is a Cloudflare Worker (`worker.ts`) acting as an
 * OAuth 2.1 resource server (verifies the access token's signature + audience,
 * never forwards the token) in front of port-driven tools:
 *   - ping / pet_stage_preview  (v0, prove @core is shared with web)
 *   - report_evidence           (agent reports progress → normalized evidence → ingest port)
 *   - goal_status / list_milestones (read milestones via the repo port)
 *   - get_inbox                 (stub; v1b)
 *
 * All external I/O sits behind injected ports so the tool layer is mockable; the
 * production adapters are placeholders marked `// TODO(v1a-live)`.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { stageForXp } from "@core/domain";
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

  registerAimcubTools(server, deps);
  return server;
}
