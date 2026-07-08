import type { HarmonicIndexManager } from "../../src/memory/harmonic-index";
import type { CognitiveGraphManager } from "../../src/memory/cognitive-graph";
import type { CostEstimator } from "../../src/cost/cost-estimator";
import type { CognitiveRouter } from "../../src/cost/cognitive-router";

export interface MemoryService {
  harmonicIndex: HarmonicIndexManager;
  cognitiveGraph: CognitiveGraphManager;
  search(query: string, topK?: number): ReturnType<HarmonicIndexManager["search"]>;
}

export interface CostService {
  estimator: CostEstimator;
  router: CognitiveRouter;
  getModelRoute(agentType: string, remaining: number, total: number): { model: string; reason: string };
}

export interface Services {
  memory: MemoryService;
  cost: CostService;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  services: Services
) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}
