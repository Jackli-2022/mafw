import type { HarmonicIndexManager } from "./core/memory/harmonic-index";
import type { CognitiveGraphManager } from "./core/memory/cognitive-graph";
import type { L5Store } from "./core/memory/l5-store";
import type { CostEstimator } from "./core/cost/cost-estimator";
import type { CognitiveRouter } from "./core/cost/cognitive-router";
import type { AutomationEngine } from "./automation-engine";
import type { SchedulerLedger } from "./ledger";
import type { DesktopClient } from "./desktop-client";

export interface MemoryService {
  harmonicIndex: HarmonicIndexManager;
  cognitiveGraph: CognitiveGraphManager;
  l5: L5Store;
  search(query: string, topK?: number, options?: { retriever?: 'token' | 'bm25' | 'guided' }): ReturnType<HarmonicIndexManager["search"]>;
}

export interface CostService {
  estimator: CostEstimator;
  router: CognitiveRouter;
  getModelRoute(agentType: string, remaining: number, total: number): { model: string; reason: string };
}

export interface Services {
  memory: MemoryService;
  cost: CostService;
  automation?: AutomationEngine;
  ledger?: SchedulerLedger;
  mafwDir?: string;
  desktop?: DesktopClient;
  /** Gateway-provided callback for agent process restart (MCP tool). */
  restartAgent?: () => Promise<{ success: boolean; mode: string }>;
  /** Gateway-provided callback: start a new manager topic (rotate session). */
  rotateManagerSession?: (reason?: string) => Promise<{ sessionId: string; previousSessionId?: string; created: 'initial' | 'rotated' }>;
  /** Gateway-provided callback: one-off side-question session (create→prompt→discard). */
  btwAsk?: (question: string) => Promise<{ answer: string }>;
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
