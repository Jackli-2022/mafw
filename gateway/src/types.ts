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
  /** Optional archive source-turn search for mafw_get_memory (C0). */
  searchArchive?: (sessionID: string, anchors: string[], k: number) => import('./memory/gateway-db').T1Observation[];
  /** V1: t1 pointer redemption — archive rows by session tail + turn. */
  resolveT1?: (sessionTail: string, turnId: number) => import('./memory/gateway-db').T1Observation[];
}

export type ToolHandler = (
  args: Record<string, unknown>,
  services: Services
) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;

export interface ToolDefinition {
  name: string;
  description: string;
  /** MCP stable spec 工具注解（hints, not guarantees）——registry 构造期从 mafw 专属表物化（2026-10-22 spec §5.3） */
  annotations?: import("./runtime/tool-classes").MafwToolAnnotations;
  /** MCP stable spec 结构化输出声明（JSON Schema，顶层 object；schema 照实原则） */
  outputSchema?: Record<string, unknown>;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}
