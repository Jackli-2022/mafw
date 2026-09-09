import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { IncomingMessage, ServerResponse } from "http";
import { ToolRegistry } from "./tool-registry";
import { Services } from "../types";
import { config } from "../config";
import { log } from "../core/utils/logger";

/**
 * Stateless StreamableHTTP MCP endpoint (MCP 2025-03-26 transport).
 *
 * Served on the same `/mcp` path as the legacy SSE endpoint — clients are
 * routed by shape (see index.ts): POST without a `sessionId` query param and
 * GET carrying `mcp-protocol-version` come here; everything else goes to the
 * legacy SSE handler. opencode's client prefers StreamableHTTP and falls
 * back to SSE, so modern clients automatically land on this path.
 *
 * Stateless contract: every request gets a fresh Server+transport pair and
 * the JSON-RPC response is returned inline on the POST (no long-lived GET
 * stream, no session state). This structurally eliminates the response
 * misrouting bug class and session staleness of the legacy SSE transport.
 */
export class McpStreamableEndpoint {
  private toolRegistry: ToolRegistry;
  private services: Services;

  constructor(toolRegistry: ToolRegistry, services: Services) {
    this.toolRegistry = toolRegistry;
    this.services = services;
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

  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const server = this.createServer();
    // Stateless mode: no session id is issued or validated; JSON responses
    // are returned directly on the POST instead of an SSE stream.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    const cleanup = () => {
      void server.close().catch(() => {});
      void transport.close().catch(() => {});
    };
    res.on("close", cleanup);
    res.on("error", cleanup);

    await server.connect(transport);

    // Collect the JSON-RPC body and hand it to the transport pre-parsed
    // (we are on raw node:http, not express with a json body parser).
    const body = await readJsonBody(req);
    if ((body as any)?.method === "initialize") {
      log.info("[MCP] StreamableHTTP initialize (stateless JSON mode)");
    }
    await transport.handleRequest(req, res, body);
  }
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 10 * 1024 * 1024) {
        reject(new Error("MCP request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err: any) {
        reject(new Error(`Invalid JSON body: ${err.message}`));
      }
    });
    req.on("error", reject);
  });
}
