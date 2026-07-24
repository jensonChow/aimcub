/**
 * Per-session local MCP bridge for an embedded planning brain.
 *
 * Aimcub's planning tools stay first-party — contracts, permissions, and
 * validation live in `@aimcub/llm` — but when an EXTERNAL brain (Claude Code,
 * Codex) drives the breakdown, it connects through the external boundary like
 * any other agent: MCP. This bridge projects the planning-session tool surface
 * over a loopback streamable-HTTP endpoint that exists only for the lifetime of
 * one session and only answers requests carrying the session's bearer token.
 *
 * The blocking-question contract rides on MCP semantics: an `ask_user` call's
 * HTTP response is simply not sent until the user answers — the brain's tool
 * call blocks exactly like any slow tool.
 */
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { PLANNING_SESSION_TOOL_DEFINITIONS, type PlanningSession } from "@aimcub/llm";

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const BRIDGE_PATH = "/mcp";

export interface PlanningMcpBridgeOptions {
  session: PlanningSession;
  /** MCP server name the runtime sees; defaults to "aimcub". */
  serverName?: string;
  /** Loopback host to bind; defaults to 127.0.0.1. */
  host?: string;
}

export interface PlanningMcpBridge {
  url: string;
  authToken: string;
  serverName: string;
  /** Resolve a parked `ask_user` call with the reply body from the session. */
  resolvePending(requestId: string, body: Record<string, unknown>): boolean;
  /** Number of parked tool calls (0 or 1 under the one-question invariant). */
  pendingCount(): number;
  close(): Promise<void>;
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("request body is not valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function toolText(body: Record<string, unknown>): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(body) }] };
}

export async function startPlanningMcpBridge(options: PlanningMcpBridgeOptions): Promise<PlanningMcpBridge> {
  const serverName = options.serverName ?? "aimcub";
  const host = options.host ?? "127.0.0.1";
  const authToken = randomBytes(24).toString("hex");
  const pending = new Map<string, (body: Record<string, unknown>) => void>();
  const activeResponses = new Set<ServerResponse>();
  let closed = false;

  function buildMcpServer(connectionClosed: AbortSignal): Server {
    const server = new Server(
      { name: "aimcub-planning-bridge", version: "0.1.0" },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: PLANNING_SESSION_TOOL_DEFINITIONS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const disposition = await options.session.handleToolCall(
        request.params.name,
        request.params.arguments ?? {},
      );
      if (disposition.kind === "reply") return toolText(disposition.body);
      const body = await new Promise<Record<string, unknown>>((resolve) => {
        pending.set(disposition.requestId, resolve);
        // If the brain's connection dies while the question is parked (client
        // tool timeout, dropped socket), neither the session nor the UI may
        // stay stuck on a question nobody is waiting for: record it skipped.
        // On normal completion the close event fires AFTER resolution, and the
        // pending guard makes this a no-op.
        connectionClosed.addEventListener("abort", () => {
          if (!pending.has(disposition.requestId)) return;
          pending.delete(disposition.requestId);
          options.session.provideAnswer(disposition.requestId, { skipped: true });
          resolve({ error: "question_connection_lost" });
        });
      });
      return toolText(body);
    });
    return server;
  }

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.headers.authorization !== `Bearer ${authToken}`) {
      res.writeHead(401, { "content-type": "application/json" }).end(
        JSON.stringify({ error: "unauthorized" }),
      );
      return;
    }
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? host}`);
    if (url.pathname !== BRIDGE_PATH) {
      res.writeHead(404).end();
      return;
    }
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      res.writeHead(400, { "content-type": "application/json" }).end(
        JSON.stringify({ error: error instanceof Error ? error.message : "bad request" }),
      );
      return;
    }
    // Stateless bridge: one Server + transport pair per request, all sharing the
    // single session object, so parallel tool calls from the brain never contend
    // on transport state (an ask_user can hang while a search still answers).
    const closedController = new AbortController();
    const mcpServer = buildMcpServer(closedController.signal);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      closedController.abort();
      void transport.close();
      void mcpServer.close();
    });
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  const httpServer: HttpServer = createServer((req, res) => {
    activeResponses.add(res);
    res.on("close", () => activeResponses.delete(res));
    void handleRequest(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500).end();
      else res.end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, host, () => resolve());
  });
  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("planning MCP bridge failed to bind a loopback port");
  }

  return {
    url: `http://${host}:${address.port}${BRIDGE_PATH}`,
    authToken,
    serverName,
    resolvePending(requestId, body) {
      const resolve = pending.get(requestId);
      if (!resolve) return false;
      pending.delete(requestId);
      resolve(body);
      return true;
    },
    pendingCount() {
      return pending.size;
    },
    async close() {
      if (closed) return;
      closed = true;
      // Release any parked tool call so its held-open response can flush before
      // the server stops accepting work.
      for (const [requestId, resolve] of pending) {
        pending.delete(requestId);
        resolve({ error: "session_closed" });
      }
      // Wait for in-flight responses (including just-released parked ones) to
      // finish flushing, then tear down every remaining socket: clients hold
      // keep-alive connections that would park a bare close() forever.
      const drainDeadline = Date.now() + 1_000;
      while (activeResponses.size > 0 && Date.now() < drainDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        httpServer.closeAllConnections();
      });
    },
  };
}
