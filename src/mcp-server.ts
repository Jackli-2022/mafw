/**
 * @deprecated MCP Server is now embedded in Gateway via SSE transport.
 * This file is kept for ENABLE_LEGACY_MCP fallback only.
 * See gateway/src/mcp/sse-transport.ts for the active implementation.
 * Will be removed in next major version.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as path from "path";
import { HarmonicIndexManager } from "./memory/harmonic-index";
import { KnowledgeGraphManager } from "./graph/knowledge-graph-manager";
import { CostEstimator } from "./cost/cost-estimator";
import { CognitiveRouter } from "./cost/cognitive-router";
import { registerTools } from "./mcp/tools";

const projectDir = process.env.MAFW_PROJECT_DIR || process.cwd();
const gatewayUrl = process.env.MAFW_GATEWAY_URL || "http://localhost:3004";

const harmonicIndex = new HarmonicIndexManager(projectDir);
const knowledgeGraph = new KnowledgeGraphManager(
  path.join(projectDir, ".mafw", "data", "knowledge-graph.json")
);
const costEstimator = new CostEstimator();
const cognitiveRouter = new CognitiveRouter();

const { definitions, handlers } = registerTools();

const server = new Server(
  {
    name: "mafw-mcp-server",
    version: "4.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: definitions,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;
  const handler = handlers[toolName];
  if (!handler) {
    throw new Error(`Unknown tool: ${toolName}`);
  }
  const args = request.params.arguments ?? {};
  return handler(args as Record<string, unknown>);
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  console.error("MCP server error:", err);
  process.exit(1);
});
