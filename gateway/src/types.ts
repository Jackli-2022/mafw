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
  /** T1 dense retrieval over active/archive verbatim rows. */
  searchT1?: (query: string, k: number) => Promise<import('./recall/verbatim-recall').T1Hit[]>;
  /** Episode-channel retrieval (turn hits aggregated by episode). */
  searchEpisodes?: (query: string, k: number) => Promise<import('./recall/t1-episode-search').EpisodeHit[]>;
  /** Episode metadata / members for `mafw_get_memory("t1ep:<id>")`. */
  getEpisode?: (episodeId: string) => import('./recall/t1-episodes').T1EpisodeRecord | null;
  listEpisodeMembers?: (episodeId: string) => import('./recall/t1-episodes').T1EpisodeMember[];
  /** Observe-only T1 access event (never mutates energy/ranking). */
  recordT1Retrieval?: (
    traceId: string,
    kind: import('./memory/gateway-db').T1RetrievalKind,
    score?: number,
  ) => void;
  /** Resolve a permanent T1 trace id to its full active+archive turn. */
  readTrace?: (traceId: string) => import('./memory/gateway-db').T1TraceRead | null;
  /** Cheap existence check for exact T1 provenance validation on write. */
  hasTrace?: (traceId: string) => boolean;
  /** Per-session attention topic (not a long-term fact). */
  getTopic?: (sessionID: string) => import('./recall/topic-state').TopicState | null;
  setTopic?: (input: import('./recall/topic-state').SetTopicInput) => import('./recall/topic-state').TopicState;
  /** Map a source trace to its T1 episode (soft grounding hint). */
  findEpisodeByTrace?: (traceId: string) => string | null;
  /** Bounded abstract→T1 activation propagation (never fails the read). */
  propagateT1Activation?: (traceIds: string[]) => void;
  /** Plan C: human review items and their store (MCP respond handler). */
  podReview: import('./core/pod/pod-review-service').PodReviewService;
  podStore: import('./core/pod/pod-store').PodStore;
  /** Human-confirmed decision records (MCP draft handler only). */
  decisionRecords?: import('./core/decision/decision-record-service').DecisionRecordService;
  /** Current project directory for agent-scoped writes. */
  projectDir?: () => string | null;
  /**
   * E7-4: live resource pressure (narrow face of `governor.pressure()`), read
   * per call; absent governor → null (fail-open). MCP memory writes use it to
   * reject critical-disk writes with `disk_low`.
   */
  pressure?: () => { disk: string; degraded: string[] } | null;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  services: Services
) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean; structuredContent?: Record<string, unknown> }>;

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
