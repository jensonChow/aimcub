/**
 * goalpet-mcp — public-facing MCP server (Streamable HTTP).
 * v0: stateless skeleton exposing ping + pet_stage_preview (the latter calls into @core/domain,
 * proving the "shared core across all four clients" holds — the MCP client and the web client
 * run the same pet-growth logic).
 *
 * v1a will add: an OAuth 2.1 resource server (validates aud, never forwards the token) plus
 * set_goal / submit_evidence / report_progress / complete_milestone / get_status / get_inbox
 * and other tools.
 */
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { stageForXp } from "@core/domain";

function buildServer(): McpServer {
  const server = new McpServer({ name: "goalpet-mcp", version: "0.0.0" });

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

  return server;
}

const app = express();
app.use(express.json());

// Streamable HTTP, single endpoint /mcp (SSE is deprecated and not implemented). Stateless mode: a fresh server+transport per request.
app.post("/mcp", async (req, res) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(`goalpet-mcp listening on :${port}/mcp`);
});
