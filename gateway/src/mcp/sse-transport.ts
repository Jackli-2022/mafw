import { config } from "../config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { IncomingMessage, ServerResponse } from "http";
import { ToolRegistry } from "./tool-registry";
import { Services } from "../types";
import { log } from "../core/utils/logger";

/**
 * Legacy SSE MCP endpoint (kept for pre-StreamableHTTP clients; opencode
 * prefers the stateless StreamableHTTP handler on the same path).
 *
 * Session-isolation contract (regression-tested in
 * tests/unit/mcp-sse-multi-client.test.ts): EVERY SSE connection gets its own
 * `Server` instance. The MCP SDK `Protocol` supports exactly one transport —
 * sharing a single Server across sessions routed responses to whichever
 * client connected last, starving everyone else (the 2026-09-09 "-32001
 * intermittent timeout" incident).
 *
 * Each stream also carries `: ping` keep-alive comment frames so idle
 * connections are not killed by client-side idle timeouts (observed ~305s
 * aborts) and half-open connections are detected on write failure.
 */
export class McpSSEEndpoint {
  private toolRegistry: ToolRegistry;
  private services: Services;
  private heartbeatMs: number;
  private sessions: Map<
    string,
    { server: Server; transport: SSEServerTransport; heartbeat: ReturnType<typeof setInterval> }
  > = new Map();

  constructor(
    toolRegistry: ToolRegistry,
    services: Services,
    opts?: { heartbeatMs?: number },
  ) {
    this.toolRegistry = toolRegistry;
    this.services = services;
    this.heartbeatMs = opts?.heartbeatMs ?? 15000;
  }

  private createServer(): Server {
    const server = new Server(
      { name: config.mcpserver.name, version: config.mcpserver.version },
      { capabilities: { tools: {} } }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.toolRegistry.definitions,
    }));

    server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const handler = this.toolRegistry.handlers[req.params.name];
      if (!handler) {
        throw new Error(`Unknown tool: ${req.params.name}`);
      }
      const args = req.params.arguments ?? {};
      return handler(args as Record<string, unknown>, this.services);
    });

    return server;
  }

  sessionCount(): number {
    return this.sessions.size;
  }

  async handleSSE(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const transport = new SSEServerTransport("/mcp", res);
    const sessionId = transport.sessionId;
    const server = this.createServer();

    const heartbeat =
      this.heartbeatMs > 0
        ? setInterval(() => {
            // Comment frames are ignored by every SSE parser; a write failure
            // surfaces as res 'error'/'close' and cleans the session up.
            try {
              res.write(": ping\n\n");
            } catch {
              // cleaned up via 'close'
            }
          }, this.heartbeatMs)
        : null;
    if (heartbeat) heartbeat.unref();

    const cleanup = () => {
      if (heartbeat) clearInterval(heartbeat);
      if (this.sessions.delete(sessionId)) {
        log.info(`[MCP] SSE session closed ${sessionId.slice(0, 8)} (active: ${this.sessions.size})`);
      }
      void server.close().catch(() => {});
    };
    res.on("close", cleanup);
    res.on("error", cleanup);

    this.sessions.set(sessionId, { server, transport, heartbeat: heartbeat! });
    log.info(`[MCP] SSE session connected ${sessionId.slice(0, 8)} (active: ${this.sessions.size})`);

    await server.connect(transport);
  }

  async handleMessage(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || "", "http://localhost");
    const sessionId = url.searchParams.get("sessionId") || "";

    const session = this.sessions.get(sessionId);
    if (!session) {
      log.warn(`[MCP] POST for unknown session ${sessionId.slice(0, 8) || "(empty)"} (active: ${this.sessions.size})`);
      res.writeHead(404);
      res.end(JSON.stringify({ error: "Session not found" }));
      return;
    }

    await session.transport.handlePostMessage(req, res);
  }
}
