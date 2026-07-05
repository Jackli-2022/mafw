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

const projectDir = process.env.MAFW_PROJECT_DIR || process.cwd();
const gatewayUrl = process.env.MAFW_GATEWAY_URL || "http://localhost:3004";

const harmonicIndex = new HarmonicIndexManager(projectDir);
const knowledgeGraph = new KnowledgeGraphManager(
  path.join(projectDir, ".mafw", "data", "knowledge-graph.json")
);
const costEstimator = new CostEstimator();
const cognitiveRouter = new CognitiveRouter();

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
  tools: [],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  throw new Error(`Unknown tool: ${request.params.name}`);
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  console.error("MCP server error:", err);
  process.exit(1);
});
