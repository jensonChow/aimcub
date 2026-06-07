/**
 * goalpet-mcp — 对外 MCP server(Streamable HTTP)。
 * v0:无状态(stateless)骨架,暴露 ping + pet_stage_preview(后者调用 @core/domain,
 * 证明「四端共享核心」成立 —— MCP 端与 web 端用同一份宠物成长逻辑)。
 *
 * v1a 将补:OAuth 2.1 资源服务器(校验 aud、token 不透传)+ set_goal / submit_evidence /
 * report_progress / complete_milestone / get_status / get_inbox 等工具。
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

// Streamable HTTP,单端点 /mcp(SSE 已淘汰,不实现)。无状态模式:每请求新建 server+transport。
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
