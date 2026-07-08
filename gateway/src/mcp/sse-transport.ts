import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { IncomingMessage, ServerResponse } from "http";
import { ToolRegistry } from "./tool-registry";
import { Services } from "../types";

export class McpSSEEndpoint {
  private server: Server;
  private transports: Map<string, SSEServerTransport> = new Map();
  private services: Services;

  constructor(toolRegistry: ToolRegistry, services: Services) {
    this.services = services;

    this.server = new Server(
      { name: "mafw-mcp-server", version: "4.1.0" },
      { capabilities: { tools: {} } }
    );

    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: toolRegistry.definitions,
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const handler = toolRegistry.handlers[req.params.name];
      if (!handler) {
        throw new Error(`Unknown tool: ${req.params.name}`);
      }
      const args = req.params.arguments ?? {};
      return handler(args as Record<string, unknown>, this.services);
    });
  }

  async handleSSE(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const transport = new SSEServerTransport("/mcp", res);
    const sessionId = transport.sessionId;
    this.transports.set(sessionId, transport);

    res.on("close", () => {
      this.transports.delete(sessionId);
    });

    await this.server.connect(transport);
  }

  async handleMessage(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || "", "http://localhost");
    const sessionId = url.searchParams.get("sessionId") || "";

    const transport = this.transports.get(sessionId);
    if (!transport) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: "Session not found" }));
      return;
    }

    await transport.handlePostMessage(req, res);
  }
}
