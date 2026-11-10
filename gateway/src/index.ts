import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import * as http from 'http';
import * as https from 'https';
import * as yaml from 'js-yaml';
import { spawn, execSync } from 'child_process';
// import { DashboardServer } from './dashboard/server';
import { config } from "./config";
import { MutexQueue } from './concurrency/mutex-queue';
import { TtlMap } from './concurrency/ttl-map';
import { Scheduler, TaskSkippedError, TaskTimeoutError } from './scheduler';
import { getDefaultSessionRegistry } from './session';
import { InternalRolesView } from './session/views/internal-roles';
import { log } from './core/utils/logger';
import {
  createGatewayRuntimeIdentity,
  gatewayHealthFields,
  loadGatewayReleaseMetadata,
  type GatewayReleaseMetadata,
  type GatewayRuntimeIdentity,
} from './release-info';
import { isLoopbackAddr, authorizeRequest, authorizeWsUpgrade } from './core/auth';
import { NodeDriver } from './core/goal/driver';
import { parseReviewRubric, taskIdsFromWavePlan } from './core/goal/review-rubric';
import { ensureGoalState, effectiveRevision, isTerminalState, loadGoalState } from './core/goal/state-v3';
import { isTaskType } from './orchestration/capability-ledger';
import {
  resolveGoalRefFromEntries,
  type GoalProjectEntry,
  type GoalResolution,
} from './core/goal/goal-identity';
import { recoverGoals, watchdogScan } from './core/goal/recovery';
import { attachGoalRoutes } from './routes/goals-inline';
import { handleTerminal } from './routes/terminal';
import { TerminalService } from './terminal/terminal-service';
import { matchTerminalConnectUrl } from './terminal/terminal-protocol';
import { getActivePolicy } from './orchestration/policy';
import { recordSessionInDb } from './core/engine/phase-orchestrator';

import { McpSSEEndpoint } from "./mcp/sse-transport";
import { McpStreamableEndpoint } from "./mcp/streamable-endpoint";
import { ChatSessionManager } from "./chat/chat-sessions";
import { SdkSessionResource } from "./resources/sdk-session";
import { structuredOutput } from './runtime/structured-output';
import { SubagentService } from './runtime/subagent-service';
import { TaskService, TaskError } from './runtime/task-service';
import { claimGatewayInstance } from './runtime/instance-ownership';
import {
  gatewayDiscoveryPath,
  publishGatewayDiscovery,
  readGatewayDiscovery,
  type GatewayDiscoveryHandle,
} from './runtime/gateway-discovery';
import { mafwRuntimeDir } from './runtime/runtime-paths';
import type { InstanceLock } from './runtime/instance-lock';
import {
  BackgroundJobError,
  BackgroundJobRegistry,
  BackgroundJobService,
  jobFromTask,
} from './core/background/background-jobs';
import { PodStore } from './core/pod/pod-store';
import { PodEventService } from './core/pod/pod-event-service';
import { PodEventWake } from './core/pod/pod-event-wake';
import { buildPodPresence, type PodPresence } from './core/pod/pod-presence';
import { dispatchAuthorized } from './routes/registry-dispatch';
import {
  classifyGoalArchive,
  classifyMemberMessage,
  goalDedupeKey,
  memberDedupeKey,
} from './core/pod/pod-event-model';
import { parentProjectDirForWorktree } from './core/pod/pod-identity';
import { PodService } from './core/pod/pod-service';
import { PodTaskService } from './core/pod/pod-task-service';
import { PodMessageService } from './core/pod/pod-message-service';
import { PodMemoryService } from './core/pod/pod-memory-service';
import { PodGoalService } from './core/pod/pod-goal-service';
import { PodGoalRevisionService } from './core/pod/pod-goal-revision-service';
import { PodSessionSupervisor } from './core/pod/pod-session-supervisor';
import { PodSessionLifecycle } from './core/pod/pod-session-lifecycle';
import { PodDirectionService } from './core/pod/pod-direction-service';
import { PodTechLeadService, TECH_LEAD_AGENT } from './core/pod/pod-tech-lead-service';
import { LeadTopicStore } from './core/lead/lead-topic-store';
import { LeadHandoffService } from './core/lead/lead-handoff-service';
import { TopicMessageIndexStore } from './core/lead/topic-message-index';
import { LeadTopicSummaryService } from './core/lead/lead-topic-summary-service';
import { summarizeTopic } from './core/lead/topic-summary';
import { PodWorktreeService } from './core/pod/pod-worktree-service';
import { createTechLeadRuntimeAdapter } from './core/pod/pod-tech-lead-runtime-adapter';
import { PodProbeService, probeReportPath } from './core/pod/pod-probe-service';
import { PodContextSelectionService } from './mcp/handlers/pod-context-select';
import { ProbeWorkspaceFactory } from './core/pod/pod-probe-workspace';
import type { GoalProbePort, GoalProbeSessionBinding } from './core/goal/driver';
import type { ProbeRequest, ProbeReport } from './core/goal/probe';
import { goalVerdictFromState, type PodGoalDescription } from './core/pod/pod-view';
import { buildPodGoalResult } from './core/pod/pod-result';
import {
  createGoalIntake,
  findGoalRequestPath,
  makePodGoalId,
  readGoalRequest,
  shouldAutoStartGoalEvent,
} from './core/goal/goal-intake';
import { currentAssignmentSummary } from './core/goal/assignment';
import { PodAccess } from './core/pod/pod-access';
import { PodBudget } from './core/pod/pod-budget';
import { PodMessageDelivery } from './core/pod/pod-message-delivery';
import { PodA2ABridge } from './core/pod/pod-a2a-bridge';
import { PodA2AAgent } from './core/pod/pod-a2a-agent';
import { PodA2AArtifactStore } from './core/pod/pod-a2a-artifacts';
import { canonicalProjectDir, podInternalSessionRoleForNode } from './core/pod/pod-identity';
import { createToolRegistry } from "./mcp/tool-registry";
import { abstractionLevelFor } from './core/memory/abstraction-level';
import { MemoryService } from "./memory/service";
import { initEmbeddingRuntime, computeDenseScores, getEmbeddingRuntime, setEmbeddingRuntime } from "./memory/embedding-runtime";
import { EmbeddingIndexer } from "./memory/vector-store";
import { onMemoryWritten } from "./memory/harmonic-file-store";
import { MinHashMerger } from "./core/memory/minhash-merger";
import { GatewayDatabase } from "./memory/gateway-db";
import { TurnPipeline } from "./recall/turn-pipeline";
import { ReflectionPipeline } from "./recall/reflection";
import { StaleVerifyPipeline } from "./recall/stale-verify";
import { getRetrievalEventBuffer } from "./core/memory/retrieval-events";
import { MemoryWorker } from "./recall/memory-worker";
import { SessionWorkerPool } from "./recall/session-worker-pool";
import { ReflectCursor } from "./recall/reflect-cursor";
import { IndexScanService, resolveScanBaseUrl } from "./recall/index-scan";
import { PipelineHeartbeat } from "./recall/pipeline-heartbeat";
import { PipelineBudget } from "./recall/pipeline-budget";
import { buildMafwCommandRegistry } from "./routes/mafw-commands";
import type { MafwCommandRegistry } from "./commands/registry";
import { scanCommandDirs, watchCommandDirs, type CommandDir } from "./commands/custom-commands";
import { registerCustomCommands } from "./commands/custom-exec";
import { exec } from "child_process";
import { ConsolidationService, consolidationJudge } from "./memory/consolidation-service";
import { resolveJudgeModel } from "./memory/judge-model";
import { LayaConflictClient } from "./memory/laya-client";
import { setRouteWriteDeps, getRouteWriteDeps, routeAndWrite, getRouteStats } from "./memory/route-write";
import { buildSchemaClusters, Cluster } from "./memory/schema-clusters";
import { getReconsolidationQueue } from "./recall/reconsolidation";
import { getProviderApiKey } from "./runtime/auth";
import { readProviderApiKey, readProviderBaseUrlWithPath, readProviderTransportFromList } from "./runtime/provider-settings";
import { HarmonicUnitFileStore } from "./memory/harmonic-file-store";
import { L5Store } from "./core/memory/l5-store";
import { CostService } from "./cost/service";
import { MediaService } from "./media/media-service";
import { MediaAgent } from "./media/media-agent";
import { createPiPromptAdapter } from "./media/pi-adapter";
import { createMediaRuntimeExecutor, MediaRuntimeExecutor } from "./media/media-runtime-executor";
import { resolveMediaPrompt } from './media/resolve-prompt';
import { MediaPluginLoader } from "./media/media-plugin-loader";
import { createTtsService } from "./media/tts-service";
import { TtsEngineRegistry } from "./tts/registry";
import { createMimoEngine } from "./tts/mimo-engine";
import { createKokoroEngine } from "./tts/kokoro-engine";
import { streamSentences } from "./tts/sentence-adapter";
import { handleTtsInterrupt } from './routes/tts-interrupt';
import { TtsPluginLoader } from './tts/tts-plugin-loader';
import { AsrEngineRegistry } from './voice/registry';
import { Qwen3AsrSidecar } from './voice/sidecar/qwen3-asr-sidecar';
import { Qwen3AsrEngine } from './voice/engines/asr/qwen3-vllm';
import { resolveVoiceConfig } from './voice/config';
import { VoiceRuntime } from './voice/runtime';
import { attachVoiceSocket, isVoiceUpgradePath } from './voice/transport/ws-voice';
import { SessionKernels } from "./python/kernel-service";
import { eventBus } from "./event-bus";
import { AutomationEngine } from "./automation-engine";
import { SchedulerLedger } from "./ledger";
import { DesktopClient } from "./desktop-client";
import { QuestionLedger } from './core/manager/question-ledger';
import { ensureManagerRules } from './core/manager/system-rule-templates';
import { ensureMemoryPipelineRules } from './recall/pipeline-rules';
import { MilestonePushNotifier } from './core/manager/milestone-push';
import { WebSocketServer, WebSocket } from 'ws';
import { PushGateway } from './mobile/push-gateway';
import { DeviceStore } from './mobile/device-store';
import { PairingService } from './mobile/pairing';
import { resolveMobileBaseUrl, detectReachableHost } from './mobile/tailscale-url';
import { startTokenWatcher, readRestartInfo, markRestartNotified } from './self-update';
import { normalizeOpencodeEvent, isMalformedEvent } from './runtime/normalize';
import { UnknownEventTracker, isKnownEventType } from './runtime/event-telemetry';
import { EVENT_FLOW_MATRIX, RUNTIME_NATIVE_DROPPED } from './runtime/event-flow-matrix';
import { createBuiltinIdentityRegistry, identityMaterializable, resolveIdentityAlias, toAgentDefinition } from './runtime/identity-registry';
import { IdentityState, withIdentityPrompt } from './runtime/identity-state';
import { withInstructionSync } from './runtime/instruction-wrapper';
import { InstructionSyncService } from './core/instructions/instruction-sync-service';
import { DiscoveryService } from './core/discovery/discovery-service';
import { renderInstructionBlocks, type InstructionBlocks } from './recall/instruction-blocks';
import { isHiddenSession, selectVisibleSessions } from './core/session-visibility';

import { mafwBroadcast, projectRegisteredEvent } from './runtime/event-broadcast';
import { MAFW } from './runtime/mafw-vocabulary';
import { activateRuntimeTools, buildMafwToolFactory } from './runtime/mafw-tools';
import { attachToolsRoutes, handleToolsList, handleToolsExecute } from './routes/tools';
import { FLAT_EMITTERS } from './runtime/flat-emit-registry';
import { enrichToolIdentity } from './runtime/tool-classes';
import { BudgetGuard } from './core/budget-guard';
import { resolvePromptBudget, type PromptBudgetExisting } from './core/prompt-budget';
import { SessionQueue } from './core/session-queue';
import { shouldFlush } from './core/queue-flush';
import { createCognitionGate } from './core/cognition/cognition-gate';
import { validateRules, type CognitionRule } from './core/cognition/rules';
import { attachCognitionRoutes } from './routes/cognition';
import { attachPythonRoutes } from './routes/python';
import { attachTtsRoutes } from './routes/tts';
import { attachTerminalRoutes, attachAgentRoutes, attachMobileRoutes } from './routes/agent-terminal-mobile';
import { attachMediaRoutes } from './routes/media-upload';
import { attachProjectRoutes } from './routes/projects';
import { attachMafwCommandRoutes } from './routes/mafw-commands';
import { attachMergeMemoryRoutes } from './routes/merge-memory';
import { attachTriageRoutes } from './routes/triage';
import { attachAutomationRoutes } from './routes/automations';
import { attachChatRoutes } from './routes/chat';
import { attachObsRoutes } from './routes/obs';
import { attachSessionsCoreRoutes } from './routes/sessions-core';
import { attachSessionsReadRoutes } from './routes/sessions-read';
import { attachSessionsPermissionsRoutes } from './routes/sessions-permissions';
import { attachApprovalsRoutes } from './routes/approvals';
import { attachQuestionsPermissionsRoutes } from './routes/questions-permissions';
import { attachUsageRoutes } from './routes/usage';
import { attachRecallRoutes } from './routes/recall';
import { attachMemoryRoutes } from './routes/memory';
import { attachDashboardRoutes } from './routes/dashboard';
import { attachMiscRoutes } from './routes/misc';
import { attachConfigRoutes } from './routes/config';
import { attachLlmRoutes } from './routes/llm';
import { attachMediaPluginRoutes } from './routes/media-plugins';
import { attachPodsEventsRoutes } from './routes/pods-events-dispatch';
import { attachMcpMgmtRoutes } from './routes/mcp-mgmt';
import { attachManagerSessionRoutes } from './routes/manager-session';
import { attachDevicesMobileRoutes } from './routes/devices-mobile';
import { attachEventsSseRoutes } from './routes/events-sse';

/** 队列防楔死（spec 2026-10-22-session-queue-inbox §5.1 v2 Q2）：busy 陈旧清扫 + 队列项 TTL。 */
const BUSY_STALE_MS = 15 * 60_000;
const QUEUE_ITEM_TTL_MS = 24 * 3600_000;
const THINKING_LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
const isThinkingLevel = (v: unknown): v is string => typeof v === 'string' && THINKING_LEVELS.has(v);
import { EventStore } from './events/event-store';
import { migrateEventLogInfoToMessage } from './events/event-log-migrate';
import { enrichBroadcastFrame } from './events/broadcast-frame';
import { ApprovalPolicyService } from './core/approval/policy-service';
import { AllowlistStore } from './core/approval/allowlist-store';
import { PermissionRulesStore } from './core/approval/rules-store';
import { normalizeMode, SessionPermissionMode } from './core/approval/policy-service';
import { applyApprovalPolicy } from './core/approval/hook';
import { SessionConfigService, SessionConfigError } from './core/session-config';
import { archiveWorktree } from './core/tools/archive-worktree.js';
import { resolveNodeModel } from './core/goal/node-model';
import { nodeArtifactPaths } from './core/goal/node-prompts';
import { CheckpointService } from './core/checkpoint/checkpoint-service';
import { runAutoCheckpoint } from './core/checkpoint/auto-hook';
import { FileHistoryService } from './core/file-history/file-history-service';
import { sessionDirectoryOf } from './core/file-history/session-directory';
import { ensureGlobalOfficeSkill } from './core/office/global-skill';
import { ensurePluginCreatorSkill } from './skills/plugin-creator-skill-install';
import { ensurePiModels } from './core/media/pi-models';
import { handleFileHistoryRoutes } from './routes/file-history';
import { RunStateService } from './core/run/run-state-service';
import { RunCoordinator } from './core/run/run-coordinator';
import { DataPartService } from './core/data-parts/data-part-service';
import { defaultGit } from './core/diff/turn-diff';
import { handleSessionConfigGet, handleSessionConfigSet } from './routes/session-config';
import { mergeBudgetIntoSnapshot } from './core/goal-budget';

/**
 * pi runtime 采纳点注入三档政策评估器：pi 扩展的 tool_call 先同步直评
 * （auto 路径不 emit permission.asked，避免桌面卡片闪烁），human 落回
 * ask→applyApprovalPolicy 政策环。非 pi runtime（无 registry）静默跳过。
 */
/** 认知面注入（spec 2026-10-22-cognition-gate-rewrite）：gate（审批扩展）+ 宿主钩（input 门/redact）。 */
// pi 的审批/认知接线已收进 driver（ctx.policy → applyPiPolicyHooks）。

import { RuntimeCapabilities, fullCapabilities, minimalCapabilities, AgentRuntime, RuntimeCredentials, type CompletionChannel } from './runtime/contract';
import { validateRuntime, RuntimeValidation } from './runtime/validate';
import { buildRuntimeContractManifest } from './runtime/contract-manifest';
import { type ContractSubject, type RuntimeCoverage } from './runtime/coverage';
import { resolveEventDeclaration } from './runtime/event-declaration';
import { stampDeclaredCapabilities } from './runtime/capability-source';
import { resolvePluginProjectDir } from './runtime/session-dir';
import { RuntimePluginLoader, createRuntimePluginContext, noRuntimeRegisteredError } from './runtime/loader';
import { PI_CAPABILITIES, createPiDefinition, setPiUnknownRecorder } from './runtime/pi-adapter';
import { createPluginCredentials } from './runtime/plugin-credentials';
import { createNeutralRuntime } from './runtime/neutral-runtime';
import { getBridgeEventEntry } from './runtime/adapter-bridge';
import type { RuntimeDefinition } from '@mafw/runtime-contract';
import { createOpencodeDefinition, opencodeCapabilities, opencodeStaticEntry, type OpencodeVariant } from './runtime/opencode-definition';

import { injectServeAuth } from './runtime/proxy-auth';
import { serveAuthHeaders } from './runtime/serve-sidecar';
import { createRuntimeFacade, type RuntimeFacade, type RuntimeHost } from './runtime/runtime-facade';
import {
  enrichPermissionEvent,
  projectQuestionRequest,
  projectSession,
  projectSessions,
} from './runtime/view-projections';
import { buildRuntimeDiagnostics, type RuntimeDiagnosticsView } from './runtime/runtime-diagnostics';
import { matchRuntimeConfigRoute } from './routes/runtime-config-route';
import { TOOL_PRIMITIVE_TYPES } from './runtime/tool-part-assembler';

/** canonical 词汇表全集（事件映射加载期校验 + 插件流包装用）。
 *  三原语是 assembler 内部入口类型：可校验、可映射，但不广播（有 handleRuntimeEvent 底线）。
 *  注意：必须位于全部 import 之后——tsc CJS 产物按源码位置生成 require，
 *  顶部使用尚未 require 的模块会 TDZ 崩溃（2026-10-12 全局 dist 启动事故）。*/
const CANONICAL_TYPE_SET: ReadonlySet<string> = new Set([
  ...Object.keys(EVENT_FLOW_MATRIX),
  ...RUNTIME_NATIVE_DROPPED,
  ...TOOL_PRIMITIVE_TYPES,
]);

import { surfaceUnavailableMessage } from './runtime/runtime-access';
import { attachBackgroundJobHandlers } from './routes/background-jobs';
import { performRuntimeSwitch, type RuntimeSwitchDeps } from './routes/runtime-switch';
import type { ConformanceDeps } from './routes/conformance';
import type { PluginsRouteDeps, PluginsPackageEntry } from './routes/plugins';
import type { PluginPackagesRouteDeps } from './routes/plugin-packages';
import type { PluginWebRouteDeps } from './routes/plugin-web';
import {
  handlePluginApiRoute,
  handlePluginWebAsset,
  handlePluginWsUpgrade,
  parsePluginApiUrl,
  parsePluginWebAssetUrl,
  parsePluginWsUrl,
} from './routes/plugin-web';
import { createPluginWebTicketStore } from './plugins/plugin-web-ticket';
import type { DryEventDeps } from './routes/dry-event';
import { PluginHost } from './plugins/package-host';
import { PackageStateStore } from './plugins/package-state-store';
import { PackageManager } from './plugins/package-manager';
import { mergePackageInventory } from './plugins/package-inventory';
import type { PluginClientSnapshot } from './plugins/client-descriptor';
import { createPluginPackageContext } from './plugins/package-context';
import type { UsageStatsProvider } from './usage/plugin-context';
import { cleanupExamples } from './plugins/hub';
import type { RestartAgentDeps } from './routes/restart-agent';
import { createServeSupervisor, ServeSupervisor } from './runtime/serve-supervisor';
import { ensureServeForBuiltinRuntime } from './runtime/serve-for-runtime';
import { ensureRuntimeRoot, resolveRuntimeRoot } from './runtime/runtime-root';
import { isSelectableProject, parseRegisterIntent } from './runtime/project-selection';
import type { UsagePluginsDeps } from './routes/usage-plugins';
import { buildModelStats, ModelUsageWindows } from './usage/model-stats';

import type { ModelConfigDeps } from './routes/model-config';
import { RouteRegistry } from './routes/registry';
import { attachTypedRoute } from './routes/typed';
import { SessionListResponse } from './routes/schemas/session';
import { buildRouteCatalog } from './routes/route-catalog';
import { attachWave1Handlers } from './routes/wave1-handlers';
import { attachWave2Handlers } from './routes/wave2-handlers';
import { attachPodHandlers } from './routes/pod-handlers';
import { attachPodA2ARoutes } from './routes/pod-a2a';
import type { EmbeddingConfigDeps } from './routes/embedding-config';
import { runManagerRotate, ManagerRotateDeps, ManagerRotateResult } from './routes/manager-rotate';
/**
 * MAFW Scheduler — v5.0 SDK 编排器
 *
 * 核心设计原则：
 *   - 使用 @opencode-ai/sdk 管理 Serve 进程和 Session 生命周期
 *   - 无状态业务判断：不读 waves.json、不解析 review、不计算 loop
 *   - 文件驱动: 只读取已注册项目的 state/{goalId}.json 的 nextAction 字段
 *   - 注册表持久化: 插件注册信息写入磁盘，崩溃后可恢复
 *   - 写队列防并发: 多个 /register 同时到达时，写磁盘串行化
 *   - 可恢复：崩溃重启后从 state/ 文件 + 注册表恢复所有活跃 Goal
 */


interface StateFile {
  version: string;
  goalId: string;
  loop: number;
  phase: string | null;
  lastPhase: string | null;
  currentWave: number;
  totalWaves: number | null;
  sessions: Record<string, SessionInfo>;
  nextAction: string;
  artifacts: Record<string, string>;
  metrics?: Record<string, number>;
  error?: string;
  updatedAt: string;
  policySnapshot?: { version: string; proposalId: string | null };
  /** W1 计划审阅运行态（与 state-v3 的 planApproval 同字段；ABORT 时清空）。 */
  planApproval?: { status: 'pending' | 'approved' | 'rejected'; feedback?: string; decidedAt?: string; round: number } | null;
}

interface SessionInfo {
  id: string;
  createdAt: string;
  destroyedAt?: string;
  active: boolean;
}

interface RegisteredProject {
  projectDir: string;
  mafwDir: string;
  registeredAt: string;
}

interface Session {
  id: string;
  createdAt: string;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: string) => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// Normalize a directory path for comparison: lowercase + forward slashes
// (Windows drives/case differences must not split sessions across projects).
function normalizeDir(dir: string): string {
  return dir.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
}

async function isPortHealthy(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

import { writeManagerSlot, projectLeadSessionMetadata, backfillManagerSlot, clearSlotsForSession } from './core/manager/manager-session-runtime';
import { LeadSessionRegistry } from './core/manager/lead-session-registry';
import { shouldEnsureLeadOnStartup } from './core/manager/lead-session-resolution';
import { isLiveSessionInfo } from './runtime/session-liveness';

const INTERNAL_SESSION_TTL_DAYS = 7;

class MafwScheduler {
  private serveInstance?: { url: string; close: () => void };
  private serveUrl: string;
  private apiPort: number;
  private releaseMetadata: GatewayReleaseMetadata | null = null;
  private runtimeIdentity: GatewayRuntimeIdentity | null = null;
  private pollInterval: number;
  private projectDir: string;
  /** Runtime server root（规范：`~/.mafw/runtime-root`，懒初始化）。
   *  server 不随项目切换、不重启；session 目录仍由 opts.directory 决定。 */
  private runtimeRootDir: string | null = null;

  // ── Serve sidecar supervision ──
  // serveOwned: this gateway spawned the serve process (exit-event driven).
  // Adopted serves (orphan from a crashed gateway) fall back to a health-poll
  // watchdog because no exit event is available.
  private serveOwned = false;
  private serveExitStreak = 0;
  private serveRecovering = false;
  // External runtimes (pi) do not own serve: the watchdog can only warn and
  // reconnect the event stream. Flag keeps that warning a one-shot ERROR per
  // outage instead of an unbounded WARN loop.
  private serveExternalDownNotified = false;
  private serveWatchdogTimer: ReturnType<typeof setInterval> | null = null;
  private serveRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private serveStableTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly serveFastRetries = 3;
  private readonly serveBackoffMs = 5 * 60 * 1000;
  private readonly serveStableMs = 60_000;
  private readonly serveWatchdogIntervalMs = 30_000;
  private readonly serveWatchdogFailures = 3;

  // Self-update caller location: refreshed by every opencode event.
  private lastActiveBySession = new Map<string, number>();
  private lastWriteBySession = new Map<string, { at: number; command: string }>();
  private tokenWriterSession: { sessionID: string; at: number } | null = null;
  /** 畸形事件 warn 限频（每 runtime 30s 一次） */
  private malformedEventWarnAt = new Map<string, number>();
  private stopTokenWatcher: (() => void) | null = null;

  // SQLite T1 observation store (single writer = this gateway; the opencode
  // plugin pushes observations via /api/obs/capture). Lazy: constructed after
  // the data-dir migration so it never holds a lock on pre-migration files.
  private gatewayDbInstance: GatewayDatabase | null = null;
  private getGatewayDb(): GatewayDatabase {
    if (!this.gatewayDbInstance) {
      this.gatewayDbInstance = new GatewayDatabase(config.resolvePath(config.recall.obsCapturePath));
      // 持久事件日志（spec 2026-10-22 §5.2 接线时机）：GatewayDatabase 打开后立即构造，
      // startApiServer 之前。persist=false 或构造抛错 → 保持 null，broadcast 全路径
      // fail-open（G7：启动永不被事件日志卡死）。
      if (config.events.persist) {
        try {
          this.eventStore = new EventStore(this.gatewayDbInstance.getStore());
          // Task 14：升级前写入的 message.updated 旧帧（info 载荷）在
          // API/SSE 开放前一次性迁移为 canonical message 载荷——replay
          // 出口不保留兼容读取。幂等 + 备份失败安全（模块内 fail-safe，永不抛）。
          const migrated = migrateEventLogInfoToMessage(this.gatewayDbInstance.getStore(), {
            log: (m) => log.warn(m),
          });
          if (migrated.migrated > 0) {
            log.info(
              `[Events] migrated ${migrated.migrated}/${migrated.scanned} legacy message.updated frame(s) to properties.message`,
            );
          }
        } catch (err: any) {
          log.warn(`[Events] EventStore init failed (replay disabled, non-fatal): ${err.message}`);
        }
      }
    }
    return this.gatewayDbInstance;
  }

  // Memory pipelines (built per run so config hot-reload takes effect).
  private workerPool: SessionWorkerPool | null = null;
  private scanService: IndexScanService | null = null;
  private consolidationService: ConsolidationService | null = null;
  private layaSidecar: import("child_process").ChildProcess | null = null;
  /** Laya conflict cascade deps, hoisted so write-phase routing can reuse the
   *  same client (defined in initEmbeddingServices; undefined when disabled). */
  private layaDeps?: import("./memory/consolidation-service").ConsolidationDeps['laya'];
  /** A4 observability cache for the fok-samples counters (10s TTL). */
  private fokStatsCache: { at: number; stats: any } | null = null;
  /** S4 认知一致性：per-session recall/context 最近触达时间（有界 500）。 */
  private recallCalledBySession = new Map<string, number>();
  private heartbeat?: PipelineHeartbeat;

  private pipelineBudget?: PipelineBudget;
  /** Shared daily USD cap for background memory pipelines. Constructed lazily;
   *  zero overhead when the cap is off (allow() short-circuits before the
   *  spend query). Day boundary is UTC (aligned with the cron schedules). */
  private getPipelineBudget(): PipelineBudget {
    if (!this.pipelineBudget) {
      this.pipelineBudget = new PipelineBudget({
        budgetUsdPerDay: config.recall.pipelineBudgetUsdPerDay,
        getSpendToday: () => {
          const store = this.trajectoryStore;
          if (!store) return 0;
          const now = new Date();
          const dayStartEpochSec = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000;
          return store.getWorkerSpendSince(dayStartEpochSec);
        },
        log: (msg) => log.warn(msg),
      });
    }
    return this.pipelineBudget;
  }
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private queueSweepTimer: ReturnType<typeof setInterval> | null = null;
  private sessionSweepTimer: ReturnType<typeof setInterval> | null = null;
  // Unified session registry (kernel refactor Phase C) — the gateway's process
  // table. MUST be the default singleton: worker-origin (recall/worker-origin.ts)
  // falls back to getDefaultSessionRegistry(), and a private instance would
  // split the table in two (final review C1). Views below hold a reference;
  // worker-origin / pool / lead / pod mirrors consume it.
  private sessionRegistry = getDefaultSessionRegistry();
  // Internal worker sessions (memory pipelines) — their output must never be
  // captured back into T1 (recursion guard A). Role overlay over the session
  // registry (was: bare Map<string, string>; kv dual-write unchanged).
  private internalSessionRoles = new InternalRolesView(this.sessionRegistry);
  // Identity layer (spec 2026-10-08-runtime-neutral-agent-identity): registry 是身份
  // 单一事实源；state 持 session→identity 绑定与 (runtime, identity) 物化状态。
  private identityRegistry = createBuiltinIdentityRegistry();
  private identityState = new IdentityState();
  // Goal 编排 P1：NodeDriver（state 文件 + 事件驱动重入，替代 langgraph invoke）。
  private goalDriver: NodeDriver | null = null;
  private goalDriverMafwDirCache = new Map<string, string>();
  private getReflectCursor(): ReflectCursor {
    return new ReflectCursor(this.getGatewayDb());
  }
  /**
   * Unified priority scheduler (Phase B). AutomationEngine actions and
   * snapshot builds submit through it; budget admission consults the
   * pipeline daily USD cap using the pipelines' own allow() names.
   */
  private scheduler = new Scheduler({
    budgetChecker: (task) => {
      const b = task.budget;
      if (b?.kind === 'pipeline' && b.pipeline) {
        try {
          return { ok: this.getPipelineBudget().allow(b.pipeline), reason: 'pipeline daily cap' };
        } catch {
          return { ok: true }; // fail-open — matches PipelineBudget's own stance
        }
      }
      return { ok: true };
    },
  });
  private budgetGuards = new Map<string, BudgetGuard>(); // per-goal-session turn/cost hard stop
  private promptBudgetSessions = new Set<string>();
  /** busy 追踪（spec §5.1 v2）：value = busy 起始 ms；turn.started 置位、三终态清除；15min TTL 防楔死。 */
  private busySessions = new Map<string, number>();
  /** 会话队列 inbox（spec 2026-10-22-session-queue-inbox）。 */
  private sessionQueue = new SessionQueue();

  /** 认知面 gate/rewrite（spec 2026-10-22-cognition-gate-rewrite）。规则现读 + 引用比较缓存（热重载免费 C9）。 */
  private cognitionGateCache: { raw: unknown; valid: CognitionRule[] } = { raw: undefined, valid: [] };
  private cognitionGate = createCognitionGate({
    getRules: () => {
      const raw = config.cognition?.rules;
      if (raw !== this.cognitionGateCache.raw) {
        const { valid, errors } = validateRules(raw);
        // 有声 fail-open（终审 #3）：坏规则跳过但必须让用户知道——静默解除武装是反模式
        if (errors.length > 0) log.warn(`[Cognition] rule errors (skipped, fail-open): ${errors.join('; ')}`);
        this.cognitionGateCache = { raw, valid };
      }
      return this.cognitionGateCache.valid;
    },
    isInternalSession: (sid) => this.internalSessionRoles.has(sid),
    onEvent: (e) => {
      // cognition_gate 扁平事件（runtime_switched 先例；经 broadcast → event_log 持久化）
      this.broadcast({ type: 'cognition_gate', sessionID: e.sessionID, rule: e.rule, action: e.action, tool: e.tool, reason: e.reason } as any);
    },
  });
  private approvalPolicy!: ApprovalPolicyService; // asked 事件策略评估（manual/auto + 预算 + 内部 fail-safe）
  private allowlistStore!: AllowlistStore; // legacy 白名单（config.yaml approval 段，双读过渡）
  private permissionRules!: PermissionRulesStore; // 持久规则（~/.mafw/permission-rules.json）

  activeGoals = new Map<string, StateFile>();
  registeredProjects = new Map<string, RegisteredProject>();
  // 当前项目（桌面 Rail"切换项目"语义）：/register 时更新，kv 持久化跨重启。
  // 之前无此状态——projects/current 恒返回 entries[0]，Rail 每次 setCurrent 后
  // 被 projectsRev 重拉弹回首注册项目（切换失效根因，2026-09-22）。
  private currentProjectDir: string | null = null;
  private registryPath: string;
  private registryWriteQueue = new MutexQueue();
  private running = true;
  // private dashboard?: DashboardServer;
  private mcpEndpoint?: McpSSEEndpoint;
  private mcpStreamableEndpoint?: McpStreamableEndpoint;
  private runtime: RuntimeFacade | null = null;
  /**
   * P4 shadow registry + P5 Wave 1 dispatch：catalog 全量登记（130 条，贡献 spec），
   * Wave 1 已 attach 的 22 条在请求链顶端优先 dispatch（见 startApiServer），
   * 未 attach 的 shadow 条目自然落回 legacy 内联链。
   */
  private routeRegistry: RouteRegistry = new RouteRegistry().register(...buildRouteCatalog());
  /** 无 runtime 时的保守能力集；有诊断视图时实时读视图（能力可能随探测/降级变化）。 */
  private runtimeCapsFallback: RuntimeCapabilities = minimalCapabilities();
  private get runtimeCaps(): RuntimeCapabilities {
    return this.runtimeDiagnostics?.capabilities ?? this.runtimeCapsFallback;
  }
  private runtimeName = 'opencode';
  /** 组合根持有的诊断视图（业务核心只读 access/Experience；本视图供 /api/runtime 等 Admin 面）。 */
  private runtimeDiagnostics: RuntimeDiagnosticsView | null = null;
  /**
   * 组合根持有的进程/诊断窄面（name/capabilities/config/completion/credentials/
   * agentProcess/getBaseUrl/healthCheck/activeDialect）。RuntimeFacade 不再复制这些
   * 字段（设计 §7.1）——业务模块拿不到，组合根经此单一入口使用。
   */
  private runtimeHost: RuntimeHost | null = null;
  /** 组合根内部：热切换时记录切换前的 runtime 名（广播用，不进入业务面）。 */
  private runtimeNameBeforeSwitch: string | null = null;
  private runtimeLoader?: RuntimePluginLoader;
  /** 未知事件遥测（L1）：per-source（runtime 名 / 'api'）per-type 计数。 */
  private unknownEventTracker = new UnknownEventTracker();
  /** B2 翻译守卫失败计数（transformEvent 抛错/非法输出、normalizeMessages 违规）。 */
  private translationErrors = new Map<string, { transformEvent: number; normalizeMessages: number; lastError?: string; lastAt?: string; lastWarnAt?: number }>();
  /** B3 入口拦截计数：unmatched（监控信号）/ suppressed（声明式压制），per-runtime per-type。 */
  private translationDrops = new Map<string, { unmatched: Record<string, number>; suppressed: Record<string, number> }>();
  /** Conformance event tap：per-session 临时观察者（POST /api/runtime/conformance 用）。 */
  private eventTaps = new TtlMap<string, Set<(e: { type: string; sessionID?: string; at: number }) => void>>(5 * 60_000); // 5min TTL (conformance observers)
  private serveSupervisor: ServeSupervisor;
  private switchingRuntime = false;
  /** Abort controller for the active event stream subscription. Cancelled
   *  before re-subscribing to prevent orphaned async iterator loops. */
  private eventStreamAbort: AbortController | null = null;
  /** 持久事件日志（spec 2026-10-22；null = 纯直播 fail-open）。 */
  private eventStore: EventStore | null = null;
  /** Mode A SSE 连接：per-connection write 闭包（attachGlobalSse 返回——回放/直播统一入口）。 */
  private sseClients = new Map<http.ServerResponse, (frame: string, seq: number | null) => void>();
  /** WebSocket clients (mobile app): same events as SSE, JSON frames. */
  private wsClients: Set<WebSocket> = new Set();
  private chatSessions: ChatSessionManager;
  private sdkSession!: SdkSessionResource;
  private instructionSync?: InstructionSyncService;
  private discovery?: DiscoveryService;
  private subagentService!: SubagentService;
  private leadSessionRegistry!: LeadSessionRegistry;
  private podStore!: PodStore;
  private podService!: PodService;
  private podTaskService!: PodTaskService;
  private podMessageService!: PodMessageService;
  private podMemoryService!: PodMemoryService;
  private podGoalService!: PodGoalService;
  private podGoalRevisionService!: PodGoalRevisionService;
  private podSessionSupervisor!: PodSessionSupervisor;
  private podSessionLifecycle!: PodSessionLifecycle;
  private podDirectionService!: PodDirectionService;
  private podTechLeadService!: PodTechLeadService;
  private leadTopics!: LeadTopicStore;
  private leadTopicIndex!: TopicMessageIndexStore;
  private leadTopicSummary!: LeadTopicSummaryService;
  private podWorktreeService!: PodWorktreeService;
  private podContextSelectionService!: PodContextSelectionService;
  private podProbeService!: PodProbeService;
  private podProbeWorkspaces!: ProbeWorkspaceFactory;
  /** Task 14：探针会话 → ProbeRequest 范围绑定（审批守门在 hook/policy 里同步读取）。 */
  private readonly probeScopes = new TtlMap<string, GoalProbeSessionBinding>(10 * 60_000); // probe timeout TTL
  private podAccess!: PodAccess;
  private podBudget!: PodBudget;
  private podMessageDelivery!: PodMessageDelivery;
  private podA2ABridge!: PodA2ABridge;
  private readonly podA2AAgents = new Map<string, PodA2AAgent>();
  private readonly podPendingHandoffs = new Map<string, string[]>();
  private taskService!: TaskService;
  /** Task 3：事件驱动的作业台账（background.job.updated；shell + subagent 证据，终态不回退）。 */
  private readonly backgroundShells = new BackgroundJobRegistry();
  /** Task 3：三源统一的后台作业服务（REST 面唯一实现）。 */
  private backgroundJobs!: BackgroundJobService;
  private sessionConfigService!: SessionConfigService;
  private checkpointService!: CheckpointService;
  private fileHistory!: FileHistoryService;
  private runStateService!: RunStateService;
  private runCoordinator!: RunCoordinator;
  private dataPartService!: DataPartService;
  private memoryService?: MemoryService;
  private mediaService?: MediaService;
  private mediaAgent?: MediaAgent;
  private mediaPluginLoader?: MediaPluginLoader;
  private mediaRuntimeExecutor?: MediaRuntimeExecutor;
  private mediaRuntimeExecutorRt?: unknown;
  private pluginHost?: PluginHost;
  /** 统一插件包启用/禁用状态（manager 独立原子持久化）。 */
  private packageStateStore?: PackageStateStore;
  /** 统一插件包文件系统操作（Task 6 REST 面直接调用）。 */
  private packageManager?: PackageManager;
  /** 最近一次已提交的统一插件包 client 快照（Task 6 的 /api/plugins/client 直接读）。 */
  private pluginClientSnapshot?: PluginClientSnapshot;
  /** Plugin Web surface 票据（进程内，8h TTL；重启即失效，客户端重取）。 */
  private pluginWebTickets = createPluginWebTicketStore();
  private usageStatsProvider?: UsageStatsProvider;
  private ttsService?: ReturnType<typeof createTtsService>;
  private ttsRegistry = new TtsEngineRegistry();
  private ttsInflight = new TtlMap<string, Set<AbortController>>(3 * 60_000); // sessionId → 在途合成 (3min TTL = max TTS duration)
  private ttsPluginLoader?: TtsPluginLoader;
  private voiceSidecar?: Qwen3AsrSidecar;
  private voiceRuntime?: VoiceRuntime;
  private voiceRuntimePromise?: Promise<VoiceRuntime>;
  private voiceAsrRegistry = new AsrEngineRegistry();
  private voiceRuntimeConfig = resolveVoiceConfig({});
  private voiceWss?: WebSocketServer;
  private voiceStartBlockedUntil = 0;
  private voiceStartError = '';
  private terminalService?: TerminalService;
  private terminalWss?: WebSocketServer;
  private kernels?: SessionKernels;
  private automationEngine?: AutomationEngine;
  private ledger?: SchedulerLedger;
  private pushGateway?: PushGateway;
  private pairingService?: PairingService;
  private mdnsAdvertiser?: any; // MdnsAdvertiser
  private mafwDir!: string;
  private instanceLock: InstanceLock | null = null;
  private instanceDiscovery: GatewayDiscoveryHandle | null = null;
  private discoveryHeartbeatTimer: NodeJS.Timeout | null = null;
  private podEventService?: PodEventService;
  private podEventWake?: PodEventWake;
  private trajectoryStore: import('./trajectory/trajectory-store').TrajectoryStore | null = null;
  private anchorGraphStore: import('./graph/anchor-graph-store').AnchorGraphStore | null = null;
  private coactivationGraphStore: import('./graph/coactivation-store').CoactivationGraphStore | null = null;
  private trajectoryCollector: import('./trajectory/collector').TrajectoryCollector | null = null;
  private usagePoller: import('./usage/usage-poller').UsagePoller | null = null;
  private pluginLoader: import('./usage/plugin-loader').PluginLoader | null = null;

  // Manager sessions live in the gateway DB (kv_store scope=manager-session);
  // see GET /api/manager/session.
  constructor(projectDir: string = '.') {
    this.projectDir = projectDir;
    this.serveUrl = config.server.serveUrl;
    this.apiPort = config.server.apiPort;
    this.pollInterval = config.timeouts.backupPollInterval;
    this.registryPath = config.paths.registryFile;
    this.chatSessions = new ChatSessionManager();
    this.serveSupervisor = createServeSupervisor({
      // 全部经组合根 RuntimeHost（facade 不再暴露进程原语）且 late-bound（runtime 可热切换）：
      // managed = runtime 是否持有启停原语；health = 契约 healthCheck；
      // baseUrl/killServe = runtime 自报地址与清场原语；spawn 不传 host/port。
      managed: () => !!this.runtimeHost?.agentProcess?.spawnServe,
      health: async () => {
        try { return (await this.runtimeHost?.healthCheck?.()) ?? false; }
        catch { return false; }
      },
      baseUrl: () => this.runtimeHost?.getBaseUrl?.() ?? this.serveUrl,
      killServe: () => this.runtimeHost?.agentProcess?.killServe?.(),
      spawn: async (opts) => {
        const spawnServe = this.runtimeHost?.agentProcess?.spawnServe;
        if (!spawnServe) {
          throw new Error('active runtime does not own a server process (agentProcess.spawnServe missing)');
        }
        const sidecar = await spawnServe({ timeoutMs: opts.timeoutMs, rootDir: this.ensureRuntimeRootDir() });
        return { url: sidecar.url, close: () => sidecar.close() };
      },
    });
  }

  get serveRunning(): boolean {
    return !!this.serveInstance;
  }

  /** Check actual serve health via TCP connection, not just object existence. */
  async start() {
    log.info('MAFW Scheduler v5.0 starting...');
    this.releaseMetadata = loadGatewayReleaseMetadata(__dirname);
    this.runtimeIdentity = createGatewayRuntimeIdentity(process.env, () => randomUUID());
    log.info(
      `[Scheduler] release v${this.releaseMetadata.gatewayVersion}`
      + ` (${this.runtimeIdentity.distribution}/${this.runtimeIdentity.channel})`
      + ` instance=${this.runtimeIdentity.instanceId}`,
    );

    // One data directory, one gateway. Ownership is a lease held by the
    // process that is about to bind — not a probe against the port. A
    // contender either becomes the owner or reports the live instance so the
    // caller can attach; a self-update successor waits for the old owner to
    // release instead of stealing a live lock.
    const takeover = process.env.MAFW_TAKEOVER === '1';
    const ownership = await claimGatewayInstance({
      runtimeDir: mafwRuntimeDir(),
      takeover,
    });
    if (ownership.kind === 'deferred') {
      const holder = ownership.holder;
      process.stdout.write(`${JSON.stringify({ mafw: 'deferred', instance: holder })}\n`);
      log.info(
        `[Scheduler] Another gateway already owns ${mafwRuntimeDir()}`
        + (holder ? ` (pid ${holder.pid}, port ${holder.port})` : '')
        + '; exiting',
      );
      process.exit(0);
      return;
    }
    if (ownership.kind === 'failed') {
      log.error(`[Scheduler] Cannot own the gateway instance lock: ${ownership.error}`);
      process.exit(1);
      return;
    }
    this.instanceLock = ownership.lock;
    if (takeover) {
      log.info('[Scheduler] Takeover: acquired the instance lock from the previous gateway');
    }

    if (takeover) {
      // Keep the mafw CLI PID file pointing at this process so status/stop
      // keep working after a self-restart.
      try {
        const dir = path.join(os.homedir(), '.config', 'mafw');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'gateway.pid'), String(process.pid), 'utf-8');
      } catch {}
    }

    // 0. Init services
    await this.initServices();
    // Install the shipped Office skill before serve spawns: opencode builds its
    // skill catalog at startup, so a later write would not be discovered.
    try {
      const skill = await ensureGlobalOfficeSkill();
      if (skill.ok) {
        if (skill.action !== 'unchanged') log.info(`[Office] global skill ${skill.action}: ${skill.target}`);
      } else {
        log.warn(`[Office] global skill not installed (${skill.reason}): ${skill.target}`);
      }
    } catch (err: any) {
      log.warn(`[Office] global skill install failed (non-fatal): ${err?.message ?? err}`);
    }
    // The Creator identity requires the shipped plugin-creator skill before its
    // first inspect/write; install it beside the Office skill (same startup gate).
    try {
      const skill = await ensurePluginCreatorSkill();
      if (skill.ok) {
        if (skill.action !== 'unchanged') log.info(`[PluginCreator] global skill ${skill.action}: ${skill.target}`);
      } else {
        log.warn(`[PluginCreator] global skill not installed (${skill.reason}): ${skill.target}`);
      }
    } catch (err: any) {
      log.warn(`[PluginCreator] global skill install failed (non-fatal): ${err?.message ?? err}`);
    }
    // pi-ai's bundled xiaomi catalog lags the provider (v2.5 removed). Merge the
    // v2.6 ids into pi's models.json before Media Agent resolves a model.
    try {
      const models = await ensurePiModels();
      if (models.ok) {
        if (models.action !== 'unchanged') log.info(`[Media] pi models ${models.action}: ${models.path}`);
      } else {
        log.warn(`[Media] pi models not updated (${models.reason}): ${models.path}`);
      }
    } catch (err: any) {
      log.warn(`[Media] pi models update failed (non-fatal): ${err?.message ?? err}`);
    }
    this.setupEventBus();

    // Boot reconcile: orphan questions for inactive goals
    const bootLedger = new QuestionLedger(this.mafwDir);
    const activeCheckpoints = new Set(Array.from(this.activeGoals.keys()));
    bootLedger.bootReconcile(activeCheckpoints);

    // 1. Start HTTP API immediately (health check endpoint, MCP, etc.)
    const listening = await this.startApiServer();
    if (!listening) {
      await this.releaseInstanceOwnership();
      process.exit(1);
      return;
    }
    try {
      await this.publishInstanceDiscovery();
    } catch (err: any) {
      log.error(`[Scheduler] gateway discovery publish failed: ${err?.message ?? err}`);
      await this.releaseInstanceOwnership();
      process.exit(1);
      return;
    }

    // 2. 初始化 runtime 插件加载器
    this.runtimeLoader = new RuntimePluginLoader(config.resolvePath('runtime-plugins'));
    this.runtimeLoader.setCanonicalTypes(CANONICAL_TYPE_SET);
    await this.runtimeLoader.init();
    // 内置 pi runtime 注册：实现已抽到 `@mafw/adapter-pi`（adapters/pi），
    // gateway 只经 `runtime/pi-adapter.ts` 的包入口调用。
    this.runtimeLoader.registerBuiltinDefinition(
      'pi',
      (ctx) => createPiDefinition(ctx),
      { external: false, capabilities: PI_CAPABILITIES },
    );
    // pi 原生未知事件 → 统一遥测。翻译在 adapter 的 pi-adapter-events 内完成，
    // 未映射类型由该模块的 recorder 上报（gateway 不再有 transform fallthrough）。
    setPiUnknownRecorder((t) => { try { this.unknownEventTracker.record('pi', t); } catch { /* fail-open */ } });

    // 2b. 统一插件包宿主（必须在 createRuntime 之前 init——包 runtime 贡献要先注册）
    const pluginPackageDir = process.env.MAFW_PLUGINS_DIR || config.resolvePath('plugins');
    this.packageStateStore = new PackageStateStore(config.resolvePath());
    this.pluginHost = new PluginHost(
      pluginPackageDir,
      (name, bag) => createPluginPackageContext(name, {
        getApiKey: this.runtimeGetApiKey.bind(this),
        usageStats: () => this.usageStatsProvider,
        projectDir: this.projectDir,
        gatewayPort: config.server.apiPort,
        // ctx.effect 的清理挂在本 candidate 的 RegistrationBag：reload/replace/
        // disable/delete/离线 check 时统一执行（LIFO）。
        bag,
        // ctx.terminal 复用桌面终端同一个 TerminalService（惰性：runtime 热切换
        // 与「无 PTY 能力」都在调用时现读）。PTY 归属目录由插件按请求票据传入。
        terminal: () => this.getTerminalService(),
        emit: (event) => this.broadcast(event),
        // 包只能改 plugins.<package>.config——context 负责收敛命名空间与
        // 补丁安全校验，这里只透传到既有的 config.persistOverrides。
        persistConfig: (overrides) => {
          config.persistOverrides(overrides as unknown as Parameters<typeof config.persistOverrides>[0]);
        },
      }),
      {
        // 变更包若拥有当前 active runtime → 整包 pending，不打断正在使用的工作。
        activeRuntime: () => this.runtimeName,
        // 管理器独立持久化的禁用状态：包仍在磁盘上，但扫描时跳过。
        isDisabled: (name) => this.packageStateStore!.isDisabled(name),
        // 包事件不得冒充 canonical 事件。
        canonicalTypes: CANONICAL_TYPE_SET,
        // 包事件 + 提交后的 plugins.changed 走 gateway 既有扁平广播通道。
        broadcast: (event) => this.broadcast(event as any),
      },
    );
    this.packageManager = new PackageManager({
      pluginDir: pluginPackageDir,
      host: this.pluginHost,
      stateStore: this.packageStateStore,
    });
    this.pluginHost.bindRuntime((entries) => this.runtimeLoader?.setPackageEntries(entries));
    // 客户端快照只在 commit 后替换；handler/源码永不下发。
    this.pluginHost.onSnapshot((snapshot) => { this.pluginClientSnapshot = snapshot; });
    await this.pluginHost.init();

    // 3. 创建 SDK 客户端（auth），用于健康检查和后续通信
    const sdkConfig = {
      baseUrl: this.serveUrl,
      headers: {} as Record<string, string>,
    };
    const opencodePassword = (process.env.MAFW_RUNTIME_PASSWORD ?? process.env.MAFW_OPENCODE_PASSWORD);
    if (opencodePassword) {
      sdkConfig.headers = { Authorization: 'Basic ' + Buffer.from(`opencode:${opencodePassword}`).toString('base64') };
    }
    // opencode 注册为正式内置插件（与用户插件同一接口；同名文件/包可覆盖）。
    // v2：携带事件翻译声明——opencode 不再有「免翻译特权」，原生流经同一
    // wrap 序列（映射差异行 + transformEvent 前缀丢弃）进 canonical 管线。
    // canonical v3 / Plan 2：方言寻址——裸 `opencode`（自适应：SSE peek 探测，
    // fail-safe @v1）+ 钉死 `opencode@v1` / `opencode@v2`；三个名字共享同一
    // runtime 工厂（serve/adapter/凭据全同），差异仅在事件映射表。
    const sdkSnapshot = { ...sdkConfig, headers: { ...sdkConfig.headers } };
    const external = !!process.env.MAFW_SERVER_SERVE_URL;
    const registrationName: Record<OpencodeVariant, string> = {
      adaptive: 'opencode',
      v1: 'opencode@v1',
      v2: 'opencode@v2',
      v21: 'opencode@v21',
    };
    const opencodeDefinition = (variant: OpencodeVariant) => () => {
      const name = registrationName[variant];
      return createOpencodeDefinition({
        variant,
        registrationName: name,
        baseUrl: sdkSnapshot.baseUrl,
        headers: { ...sdkSnapshot.headers },
        hooks: {
          onUnmatched: (type) => this.recordTranslationDrop(name, type, 'unmatched'),
          onSuppressed: (type) => this.recordTranslationDrop(name, type, 'suppressed'),
          onTranslationError: (_raw, reason) => this.recordTranslationError(name, 'transformEvent', reason),
        },
      });
    };
    // 裸名 = 自适应方言（激活时探测一次，fail-safe @v1）
    this.runtimeLoader.registerBuiltinDefinition('opencode', opencodeDefinition('adaptive'), {
      external,
      capabilities: opencodeCapabilities('adaptive', external),
      eventEntry: opencodeStaticEntry('adaptive'),
    });
    // 钉死方言：映射表随定义固定，探测跳过
    this.runtimeLoader.registerBuiltinDefinition('opencode@v1', opencodeDefinition('v1'), {
      external,
      capabilities: opencodeCapabilities('v1', external),
      eventEntry: opencodeStaticEntry('v1'),
    });
    this.runtimeLoader.registerBuiltinDefinition('opencode@v2', opencodeDefinition('v2'), {
      external,
      capabilities: opencodeCapabilities('v2', external),
      eventEntry: opencodeStaticEntry('v2'),
    });
    // 钉死 2.1.0 方言（顶层 type/data + session.* 富事件；dry-event/一致性测试用）
    this.runtimeLoader.registerBuiltinDefinition('opencode@v21', opencodeDefinition('v21'), {
      external,
      capabilities: opencodeCapabilities('v21', external),
      eventEntry: opencodeStaticEntry('v21'),
    });
    const runtime = await this.createRuntime();
    this.runtime = runtime;
    this.setRuntimeDiagnostics();
    this.runtimeNameBeforeSwitch = null;
    try { await this.taskService.start(); } catch (err: any) {
      log.warn(`[Tasks] start failed (non-fatal): ${err?.message ?? err}`);
    }
    this.sdkSession.setClient(this.runtime);
    if (this.trajectoryCollector) {
      this.trajectoryCollector.setRuntime(this.runtime);
    }
    if (this.automationEngine) {
      this.automationEngine.setRuntimeClient(runtime);
    }
    log.info(`Runtime initialized: ${this.runtimeName} (capabilities: ${JSON.stringify(this.runtimeCaps)})`);

    // 3. Background: connect to OpenCode server
    const isExternal = !!runtime.external;
    let serveReady = false;
    if (isExternal) {
      log.info(`[Scheduler] Using external OpenCode Serve at ${this.serveUrl} (runtime.external=true)`);
      try { await this.waitForServeReady(); serveReady = true; }
      catch { log.warn('External OpenCode Serve not available — MCP-only mode'); }
    } else {
      if (await this.isServeHealthy()) {
        log.info('OpenCode Serve already running (adopted; health-poll watchdog)');
        serveReady = true;
        this.serveOwned = false;
        this.startServeWatchdog();
      } else {
        log.info('OpenCode Serve not reachable, checking for stale process...');
        // 清场原语归 runtime（serve 端口是实现细节；无原语的 runtime 无从清场）
        this.runtimeHost?.agentProcess?.killServe?.();
        // taskkill /F /T 是异步生效的；给监听 socket 一点释放时间，避免紧随其后的
        // spawn 仍撞 EADDRINUSE 并退化成 MCP-only。
        await this.sleep(500);
        try {
          await this.startServe();
          serveReady = !!this.serveInstance;
        } catch (err) {
          log.error(`Failed to start OpenCode Serve: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    if (serveReady) {
      // For owned sidecars this starts the health-poll watchdog; for adopted
      // sidecars it is already running and the guard is a no-op.
      this.startServeWatchdog();
    }
    // 外部 runtime（如 pi）声明 eventStream 时，事件订阅不等 opencode serve 就绪
    if (serveReady || (this.runtimeCaps.eventStream && isExternal)) {
      this.subscribeToEvents();
    }

    // 4. Dashboard is now served via the API server on the same port
    // this.dashboard = new DashboardServer(3001, this.projectDir, this);
    // this.dashboard.start();

    // 5. 恢复注册表（权威源：gateway DB kv_store + legacy 文件兜底）
    await this.recoverRegistry();

    // 5.0 Data-directory migration: move memory store + pipeline files from
    // the previously-fixed gateway package .mafw (and any project-relative
    // leftovers) to the user-home ~/.mafw data root. Runs before any other
    // migration/watcher so everything downstream reads the new fixed location.
    try {
      const { migrateDataDir } = await import('./recall/data-dir-migrate.js');
      const res = migrateDataDir(
        config.resolvePath(),
        path.join(__dirname, '..', '.mafw'),
      );
      if (res.migrated) {
        log.info(`[Scheduler] data dir migrated: ${res.moved.join(', ')}; legacy removed: ${res.legacyRemoved}`);
      }
    } catch (err: any) {
      log.warn(`[Scheduler] data dir migration failed (non-fatal): ${err.message}`);
    }

    // 5.0b Reconcile missing merged_from in .harmonic_index.json from OKF
    // frontmatter. Older addEntry() versions omitted this field.
    try {
      const { HarmonicIndexManager } = await import('./core/memory/harmonic-index.js');
      const idxMgr = new HarmonicIndexManager(config.resolvePath());
      const reconcile = idxMgr.reconcileMergedFrom();
      if (reconcile.patched > 0) {
        log.info(`[Scheduler] merged_from reconcile: ${reconcile.patched} patched, ${reconcile.alreadyOk} ok, ${reconcile.missing} missing`);
      }
    } catch (err: any) {
      log.warn(`[Scheduler] merged_from reconcile failed (non-fatal): ${err.message}`);
    }

    // 5.0 File → DB migration for the unified gateway database: rename legacy
    // t1.db, import manager-session files and the reflect cursor, snapshot the
    // registry. Idempotent; every step fails open.
    try {
      const { migrateGatewayDb } = await import('./recall/gateway-db-migrate.js');
      const managerSessions: Array<{ projectDir: string; filePath: string }> = [];
      for (const [, info] of this.registeredProjects) {
        managerSessions.push({ projectDir: info.projectDir, filePath: path.join(info.mafwDir, 'manager-session.json') });
      }
      managerSessions.push({ projectDir: this.projectDir, filePath: path.join(config.resolvePath(), 'manager-session.json') });
      const res = migrateGatewayDb(
        path.join(config.resolvePath(), 'memory'),
        managerSessions,
        path.join(config.resolvePath(), 'recall-reflect-cursor.json'),
        Object.fromEntries(this.registeredProjects),
      );
      if (res.renamed || res.managerSessions > 0 || res.cursorImported) {
        log.info(
          `[Scheduler] gateway-db migrate: renamed=${res.renamed} managerSessions=${res.managerSessions} cursor=${res.cursorImported} registrySnapshot=${res.registrySnapshot}`,
        );
      }
      // I3：迁移之后补齐存量 untagged manager-session 行（一次性打标，幂等）。
      this.backfillManagerSessionSlots();
    } catch (err: any) {
      log.warn(`[Scheduler] gateway-db migration failed (non-fatal): ${err.message}`);
    }

    // 5.0a Migrate the legacy pinned-constraints channel into harmonic memory
    // (idempotent; renamed backup marks a project as done).
    try {
      const { migrateConstraintsFiles } = await import('./recall/constraints-migrate.js');
      const projectDirs = Array.from(this.registeredProjects.values()).map((p) => p.projectDir);
      if (!projectDirs.includes(this.projectDir)) projectDirs.unshift(this.projectDir);
      const res = await migrateConstraintsFiles(projectDirs);
      if (res.migrated > 0 || res.renamed > 0) {
        log.info(`[Scheduler] constraints migration: ${res.migrated} migrated, ${res.renamed} renamed, ${res.skipped} skipped`);
      }
    } catch (err: any) {
      log.warn(`[Scheduler] constraints migration failed (non-fatal): ${err.message}`);
    }

    // 5.0a Archive legacy spiral-*.jsonl T1 files (superseded by the SQLite store).
    try {
      const { archiveLegacyT1 } = await import('./recall/legacy-t1-archive.js');
      const projectDirs = Array.from(this.registeredProjects.values()).map((p) => p.projectDir);
      if (!projectDirs.includes(this.projectDir)) projectDirs.unshift(this.projectDir);
      const res = archiveLegacyT1(projectDirs);
      if (res.archived > 0) log.info(`[Scheduler] archived ${res.archived} legacy T1 files across ${res.projects} projects`);
    } catch (err: any) {
      log.warn(`[Scheduler] legacy T1 archival failed (non-fatal): ${err.message}`);
    }

    // 5.1 Materialize every registry identity into the runtime's native format
    // (spec 2026-10-08-runtime-neutral-agent-identity §3.2/3.4 — 物化车道 1)。
    // agents.install 的语义即物化：opencode 写 agent md、pi 写 prompts+extension。
    await this.materializeIdentities();

    // 5.2 Goal NodeDriver（spec 2026-10-08-goal-orchestration-p1）：state 文件驱动的
    // 编排状态机。client 直连 sdkSession（agent 参数显式绑定身份）；memory 注入由
    // 边界 recall（消息 transform / pi host extension）按每 LLM 调用覆盖，故不再走
    // legacy withMemoryInjection 全量注入。
    this.goalDriver = new NodeDriver({
      client: {
        create: async (directory: string) => {
          const rec = await this.sdkSession.create(directory);
          return { id: rec.id };
        },
        // W1：节点会话按身份绑模型（v2 会话模型与 agent 解耦，agent md 的
        // model 只对 subagent 工具子会话生效——goal 会话必须显式 switch）。
        // W5a：模型可配置——config.goal.nodeModel 覆盖优先，身份内置兜底。
        bindModel: async (sessionID: string, agent: string) => {
          const model = resolveNodeModel(
            this.identityRegistry.get(agent)?.model,
            config.raw.goal?.nodeModel,
          );
          if (!model) return;
          const fn = this.runtime?.session.switchModel;
          if (!fn) return;
          await fn({ sessionID, model });
        },
        promptAsync: async (opts) => {
          const text = opts.parts.find((p) => p.type === 'text')?.text ?? '';
          await this.sdkSession.promptAsync(opts.sessionID, text, undefined, opts.agent, undefined, opts.outputSchema);
        },
        delete: async (sessionID: string) => {
          await this.podService?.snapshotSession(sessionID);
          await this.sdkSession.delete(sessionID);
        },
        abort: async (sessionID: string) => { await this.runtime!.session.abort({ sessionID }); },
        structured: async (sessionID: string) => structuredOutput.submitted(sessionID) ?? null,
      },
      db: {
        insertNodeRun: (i) => this.getGatewayDb().insertNodeRun(i),
        finishNodeRun: (id, p) => this.getGatewayDb().finishNodeRun(id, p),
        listNodeRuns: (g) => this.getGatewayDb().listNodeRuns(g),
        latestNodeAttempt: (g, r, l, n) => this.getGatewayDb().latestNodeAttempt(g, r, l, n),
      },
      ledger: new QuestionLedger(this.mafwDir),
      emitNodeEvent: (p) => {
        this.broadcast(p as any);
        this.onPodGoalNode(p as any);
      }, // 扁平顶层广播（事件信封契约 §5.6）
      emitPhaseTransition: (p) => eventBus.emit('phase_transition', p),
      onSessionCreated: (info) => {
        recordSessionInDb(this.getGatewayDb(), info);
        this.podService?.bindSession(info.goalId, info.phase as 'plan' | 'probe' | 'execute' | 'review', info.sessionId);
        // Plan reuses the Tech Lead discussion session, which is already
        // internal. Probe/execute/review get their own hidden role here.
        if (info.phase === 'probe' || info.phase === 'execute' || info.phase === 'review') {
          this.registerInternalSession(
            info.sessionId,
            podInternalSessionRoleForNode(info.phase),
          );
        }
        const mafwDir = this.goalDriverMafwDirCache.get(info.goalId);
        if (mafwDir) this.attachBudgetGuardForGoal(info.goalId, info.sessionId, mafwDir);
      },
      archiveGoal: (goalId, opts) => this.archiveGoal(goalId, opts as any),
      nodeTimeoutMs: (config as any).goal?.nodeTimeoutMs ?? 30 * 60_000,
      maxAttempts: 2,
      workdirForRevision: async (goalId, revision) => {
        const goal = this.podStore?.getGoalByGoalId(goalId);
        if (!goal) return null;
        // No row = legacy/in-flight Goal from before worktree support: never retrofit
        // mid-Goal (its earlier work lives in the project checkout).
        const worktree = await this.podWorktreeService.ensureExisting(goal.podId, goalId, revision);
        return worktree?.dir ?? null;
      },
      goalMode: (goalId, revision) => {
        const goal = this.podStore?.getGoalByGoalId(goalId);
        if (!goal) return null;
        return this.podStore.getGoalRevision(goal.podId, goalId, revision)?.goalMode ?? 'standard';
      },
      newApprovalId: () => `pa_${randomUUID()}`,
      canCreateNode: (goalId: string) => {
        const podId = this.podService?.getPodIdForGoal(goalId);
        if (!podId) return true;
        const pod = this.podStore?.getPod(podId);
        return !pod || pod.status === 'active' || pod.status === 'idle';
      },
      // W4: plan 节点注入 L1 能力账本 + L2 失败谱（自我认知闭环），fail-open。
      // D4b: 签名带 goalId——读 state.taskType 做同类任务先验。
      capabilityPrior: (goalId: string) => {
        try {
          const { buildCapabilityLedger, buildFailureTaxonomy, capabilityPriorBlock } = require('./orchestration/capability-ledger');
          const ledger = buildCapabilityLedger(this.getGatewayDb().listGoalOutcomes({ limit: 200 }));
          const taxonomy = buildFailureTaxonomy(this.memoryService?.harmonicIndex.getIndex().entries ?? []);
          return capabilityPriorBlock(ledger, taxonomy) || null;
        } catch {
          return null;
        }
      },
      // D4b: plan 节点注入反事实推演块（pre-mortem）——同类任务失败形态 + riskNote 要求。
      counterfactualPrior: (goalId: string) => {
        try {
          const { counterfactualBlock } = require('./orchestration/capability-ledger');
          const mafwDir = this.goalDriverMafwDirCache.get(goalId);
          const taskType = mafwDir
            ? (loadGoalState(mafwDir, goalId)?.taskType ?? 'other')
            : 'other';
          const outcomes = this.getGatewayDb().listGoalOutcomes({ limit: 200 });
          const taxonomy = require('./orchestration/capability-ledger').buildFailureTaxonomy(
            this.memoryService?.harmonicIndex.getIndex().entries ?? [],
          );
          return counterfactualBlock({ taskType }, outcomes, taxonomy) || null;
        } catch {
          return null;
        }
      },
      podContext: (goalId: string, node: 'plan' | 'execute' | 'review', sessionId: string) => {
        try {
          const podId = this.podService?.getPodIdForGoal(goalId);
          if (!podId) return null;
          const claim = this.podMessageDelivery?.claimPendingForSession(sessionId) ?? null;
          if (claim) this.podPendingHandoffs.set(sessionId, claim.ids);
          const memory = this.podMemoryService?.renderContext(podId, node) ?? null;
          return [claim?.block ?? null, memory].filter(Boolean).join('\n\n') || null;
        } catch {
          return null;
        }
      },
      // Task 17：确定性 ContextManifest（阶段基线 + Lead 选入的引用）。legacy/非 Pod Goal
      // 不注入（旧 prompt 零迁移）；Pod Goal 的缺失/敏感引用 fail-closed（driver 归档该节点）。
      contextBlock: async (goalId: string, node: 'plan' | 'probe' | 'execute' | 'review', revision: number) => {
        if (!this.podContextSelectionService) return null;
        if (!this.podService?.getPodIdForGoal(goalId)) return null;
        return this.podContextSelectionService.renderForNode({ goalId, node, revision });
      },
      onPromptDispatched: (sessionId: string) => {
        const ids = this.podPendingHandoffs.get(sessionId);
        if (!ids) return;
        this.podMessageDelivery?.commitDelivered(ids, sessionId);
        this.podPendingHandoffs.delete(sessionId);
      },
      // Task 12/13：plan 复用 Tech Lead 讨论会话（同一 revision 的讨论 → 计划连续性）。
      // 同步、非创建式查找——只有当前 revision 已有活跃讨论租约才命中；讨论回合与
      // 计划回合的 idle 竞态由 driver 的 reuse idle 宽容兜底。
      existingNodeSession: (goalId: string, node: 'plan' | 'execute' | 'review', revision: number) => {
        if (node !== 'plan') return null;
        const podId = this.podService?.getPodIdForGoal(goalId);
        if (!podId) return null;
        const member = this.podStore?.getMemberByRole(podId, 'tech_lead');
        if (!member) return null;
        const lease = this.podStore?.getActiveScopedSession({
          podId, memberId: member.id, goalId, revision, kind: 'discussion',
        }, this.runtimeName);
        return lease?.sessionId ?? null;
      },
      // Task 14：两段式 Spike。生产实现 = PodProbeService（持久化/单飞/脱敏）+
      // ProbeWorkspaceFactory（主项目之外的隔离工作区）。
      probes: this.buildGoalProbePort(),
    });

    // 6. 恢复活跃 Goal
    await this.recoverState();
    await this.podService?.reconcile().catch((err: any) => log.warn(`[Pod] reconcile failed (non-fatal): ${err?.message ?? err}`));
    await this.podGoalService?.reconcile().catch((err: any) => log.warn(`[Pod] goal reconcile failed (non-fatal): ${err?.message ?? err}`));
    await this.podSessionLifecycle?.retireStaleDiscussionLeases()
      .catch((err: any) => log.warn(`[Pod] session lease reconcile failed (non-fatal): ${err?.message ?? err}`));

    // 7. Lead 只属于已有 Pod 或仍有 in-flight Goal 的项目；Pod-less registered
    // project 不再预建一个没有用户入口的隐藏会话。
    const inFlightDirs = new Set(
      Array.from(this.activeGoals.values())
        .map((state: any) => state?.projectDir)
        .filter((dir: unknown): dir is string => typeof dir === 'string' && dir.length > 0)
        .map((dir) => canonicalProjectDir(dir)),
    );
    const leadDirs = new Map<string, RegisteredProject>();
    for (const [projectDir, info] of this.registeredProjects) {
      const canonical = canonicalProjectDir(projectDir);
      if (leadDirs.has(canonical)) continue;
      const hasPod = !!this.podStore.getPodByProject(canonical);
      if (!shouldEnsureLeadOnStartup({ hasPod, hasInFlightGoal: inFlightDirs.has(canonical) })) continue;
      leadDirs.set(canonical, info);
    }
    for (const [canonical, info] of leadDirs) {
      try {
        await this.ensureManagerSession(canonical, info.mafwDir);
      } catch (err: any) {
        log.warn(`[Scheduler] Lead session init failed for ${canonical}: ${err.message}`);
      }
    }

    // 8. 启动自动化引擎
    if (this.automationEngine) {
      this.automationEngine.start();
      log.info('[Scheduler] Automation engine started');
    }

    // 8.0 Worker-state recovery: reflect sessions that accumulated unreflected
    // episodes while their workers were evicted (fire-and-forget).
    setTimeout(() => this.restoreWorkerState(), 3000);

    // 8. 开始轮询（降级兜底）
    const pollInterval = config.timeouts.backupPollInterval;
    log.info(`[Scheduler] Starting backup polling loop (${pollInterval / 1000}s)...`);
    this.startBackupPolling();

    // 9. 监听 events 目录 (替代 HTTP POST /api/events)
    this.watchEventsDir();
    // 10. 鐩戝惉 registry 鐩綍 (鏇夸唬 HTTP POST /register)
    this.watchRegistryDir();
    // 11. 鐑厛閰嶇疆 (config.yaml / automations)
    this.watchConfigFile();
    this.watchAutomationsDir();

    // 12. Self-update: watch the restart token and, in takeover mode, notify
    // the caller session that the update completed.
    this.startTokenWatcher();
    if (takeover) {
      await this.notifyUpdateComplete();
    }
  }

  // ── Self-update ──

  private startTokenWatcher(): void {
    this.stopTokenWatcher = startTokenWatcher({
      stop: () => this.stop(),
      locateCaller: () => this.locateCallerSession(),
      onError: (message) => log.info(message),
    });
  }

  // Deterministic: the token writer's session is pinned by handleRuntimeEvent
  // when a tool command touching pending-restart.json was observed; fall back
  // to the most recently active session.
  private locateCallerSession(): string | null {
    if (this.tokenWriterSession) return this.tokenWriterSession.sessionID;
    let best: string | null = null;
    let bestAt = 0;
    for (const [sid, at] of this.lastActiveBySession) {
      if (at > bestAt) { bestAt = at; best = sid; }
    }
    return best;
  }

  // After a self-restart, tell the agent that the update finished: notify the
  // recorded caller session only. Goal-state resume semantics belong to the
  // caller; cross-project managers gain nothing from this notice (they would
  // just burn a round of LLM tokens). If the caller is unknown, fall back to
  // the primary project's manager. Failures degrade to the passive protocol.
  private async notifyUpdateComplete(): Promise<void> {
    const info = readRestartInfo();
    if (!info || info.notified) return;
    const elapsed = info.startedAt ? Math.round((Date.now() - new Date(info.startedAt).getTime()) / 1000) : undefined;
    const message = `[MAFW SYSTEM] Gateway \u81ea\u66f4\u65b0\u5df2\u5b8c\u6210\uff08reason: ${info.reason || '-'}${info.commit ? `, commit: ${info.commit}` : ''}${elapsed !== undefined ? `, \u8017\u65f6 ${elapsed}s` : ''}\uff09\u3002goal \u6267\u884c\u72b6\u6001\u5df2\u6301\u4e45\u5316\uff0c\u8bf7\u8bfb\u53d6 goal state \u7684 nextAction \u5e76\u7ee7\u7eed\u6267\u884c\uff1b\u82e5\u65e0\u672a\u5b8c\u6210\u4efb\u52a1\u5219\u65e0\u9700\u989d\u5916\u52a8\u4f5c\u3002`;

    const targets = new Set<string>();
    if (info.sessionID) {
      targets.add(info.sessionID);
    } else {
      try {
        const ms = this.readManagerSessionEntry(this.projectDir);
        if (ms?.sessionId) targets.add(ms.sessionId);
      } catch { /* skip */ }
    }

    if (!this.runtime) return;
    let notified = false;
    for (const sid of targets) {
      try {
        await this.runtime.session.promptAsync({
          sessionID: sid,
          parts: [{ type: 'text', text: message }],
          delivery: 'queue',
          idempotencyKey: 'self-update-notify',
        });
        notified = true;
        log.info(`[SelfUpdate] notified session ${sid} of update completion`);
      } catch (err: any) {
        log.warn(`[SelfUpdate] notify failed for ${sid}: ${err.message}`);
      }
    }
    markRestartNotified(notified);
  }

  // L1: hot-reload config.yaml (global + project). Rebuilds from defaults so
  // deleted keys revert; server/paths changes are reported as restart-required.
  private watchConfigFile(): void {
    const files = [config.paths.globalConfig, path.join(config.resolvePath(), 'config.yaml')];
    let timer: ReturnType<typeof setTimeout> | null = null;
    const reload = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        const prevPlugin = config.runtime?.plugin;
        const { changed, restartRequired } = config.reload();
        if (changed.length > 0) log.info(`[Scheduler] Config hot-reloaded: ${changed.join(', ')}`);
        if (restartRequired.length > 0) log.warn(`[Scheduler] Config changes need restart: ${restartRequired.join(', ')}`);
        // P0-3: mobile pairing (URL/token) hot-update — phone picks up the new
        // MagicDNS base after config.yaml edits without restarting the gateway.
        if (changed.includes('mobile') || changed.includes('server')) {
          this.pairingService?.updateConfig({
            apiToken: (config.raw as any)?.server?.apiToken || '',
            tailscaleUrl: resolveMobileBaseUrl(
              process.env.MAFW_MOBILE_TAILSCALE_URL,
              (config.raw as any)?.mobile?.tailscaleUrl,
              detectReachableHost(),
              this.apiPort,
            ),
          });
        }
        // If the runtime plugin section changed, recreate runtime and
        // re-subscribe the event stream (hot-switch, no restart needed).
        if (changed.includes('runtime')) {
          const newPlugin = config.runtime?.plugin;
        if (newPlugin !== prevPlugin && !this.switchingRuntime && !this.serveRecovering) {
          this.switchingRuntime = true;
          const prev = this.runtime;
          try {
            log.info(`[Scheduler] Runtime plugin changed: '${prevPlugin ?? 'builtin'}' → '${newPlugin ?? 'builtin'}'; hot-switching...`);
              const runtime = await this.createRuntime();
              this.runtime = runtime;
              this.setRuntimeDiagnostics();
              this.runtimeNameBeforeSwitch = null;
              // Re-materialize identities on the new runtime (fire-and-forget).
              void this.materializeIdentities().catch(() => {});
              // Same serve-ensure rationale as runtimeDeps.onSwitched: the config
              // hot-reload path can switch onto opencode from a serve-less start.
              if (this.runtimeHost?.agentProcess?.spawnServe) {
                await ensureServeForBuiltinRuntime(this.serveSupervisor, { startWatchdog: () => this.startServeWatchdog() }, log);
              }
              this.sdkSession.setClient(this.runtime);
              if (this.trajectoryCollector) this.trajectoryCollector.setRuntime(this.runtime);
              if (this.automationEngine) this.automationEngine.setRuntimeClient(runtime);
              await this.resubscribeEvents(`config hot-reload runtime plugin changed to '${newPlugin ?? 'builtin'}'`);
              await this.reconcilePodLeads();
              // Same desktop hint as the route path: hand-edited config.yaml
              // switches must also refresh the renderer (menus/tabs/manager kv).
              this.broadcast({ type: 'runtime_switched', runtime: this.runtimeName, previous: prevPlugin ?? null });
              this.discovery?.invalidate();
              void this.discovery?.broadcastKnown('runtime_switched').catch((err: any) => log.warn(`[Discovery] runtime switch broadcast failed: ${err.message}`));
              // Dispose the previous runtime AFTER the new one is fully wired
              // (mirror of the route path) — without this, switching away from
              // pi leaks its AgentSessions/ApprovalBridges/event stream.
              if (prev && (prev as any).dispose) {
                try { await (prev as any).dispose(); }
                catch (err: any) { log.warn(`[Scheduler] dispose previous runtime failed: ${err.message}`); }
              }
              log.info(`[Scheduler] Runtime hot-switched to '${this.runtimeName}'`);
            } catch (err: any) {
              log.warn(`[Scheduler] Runtime hot-switch failed (non-fatal): ${err.message}`);
            } finally {
              this.switchingRuntime = false;
            }
          }
        }
      }, 300);
    };
    for (const file of files) {
      try {
        fs.watch(file, reload);
      } catch {
        try {
          fs.watch(path.dirname(file), reload);
        } catch (err: any) {
          log.warn(`[Scheduler] Config watch failed for ${file} (non-fatal): ${err.message}`);
        }
      }
    }
    log.info('[Scheduler] Watching config files (hot-reload)');
  }

  // L2: hot-reload automation rules on file changes.
  private watchAutomationsDir(): void {
    const dir = path.join(config.resolvePath(), 'automations');
    let timer: ReturnType<typeof setTimeout> | null = null;
    const reload = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => this.automationEngine?.reloadRules(), 300);
    };
    try {
      fs.watch(dir, (_eventType, filename) => {
        if (!filename || !filename.toString().endsWith('.json')) return;
        reload();
      });
      log.info(`[Scheduler] Watching automations dir: ${dir}`);
    } catch (err: any) {
      log.warn(`[Scheduler] Automations dir watch failed (non-fatal): ${err.message}`);
    }
  }

  private watchEventsDir(): void {
    const eventsDir = path.join(config.resolvePath(), 'events');
    if (!fs.existsSync(eventsDir)) {
      fs.mkdirSync(eventsDir, { recursive: true });
    }
    try {
      fs.watch(eventsDir, (eventType, filename) => {
        if (!filename) return;
        const filePath = path.join(eventsDir, filename);
        try {
          if (!fs.existsSync(filePath)) return;
          if (fs.statSync(filePath).isDirectory()) return;
          const content = fs.readFileSync(filePath, 'utf-8');
          const event = JSON.parse(content);
          log.info(`[Events] Received: ${event.type} for ${event.goalId || ''}`);
          this.broadcast(event);
          if (event.goalId && this.activeGoals.has(event.goalId)) {
            setImmediate(() => void this.goalDriver?.advance(event.goalId));
          }
          fs.unlinkSync(filePath);
        } catch {
          // non-fatal: race condition or invalid json
        }
      });
      log.info(`[Scheduler] Watching events dir: ${eventsDir}`);
    } catch (err: any) {
      log.warn(`[Scheduler] Events dir watch failed (non-fatal): ${err.message}`);
    }
  }

  private watchRegistryDir(): void {
    const registryDir = path.join(config.resolvePath(), 'registry');
    if (!fs.existsSync(registryDir)) {
      fs.mkdirSync(registryDir, { recursive: true });
    }
    try {
      fs.watch(registryDir, (eventType, filename) => {
        if (!filename) return;
        if (filename !== 'plugin.json') return;
        const filePath = path.join(registryDir, filename);
        try {
          if (!fs.existsSync(filePath)) return;
          const content = fs.readFileSync(filePath, 'utf-8');
          const data = JSON.parse(content);
          const { projectDir, mafwDir } = data;
          if (!projectDir || !mafwDir) return;
          this.registeredProjects.set(projectDir, {
            projectDir,
            mafwDir,
            registeredAt: new Date().toISOString()
          });
          this.persistRegistry();
          // 桌面 renderer 依此事件刷新 Rail 项目列表（否则只在 gateway ready 时拉一次）。
          this.broadcast(projectRegisteredEvent(projectDir));
          log.info(`[Scheduler] Project registered via filesystem: ${projectDir}`);
        } catch {
          // non-fatal
        }
      });
      log.info(`[Scheduler] Watching registry dir: ${registryDir}`);
    } catch (err: any) {
      log.warn(`[Scheduler] Registry dir watch failed (non-fatal): ${err.message}`);
    }
  }

  private async subscribeToEvents() {
    if (!this.runtimeCaps.eventStream) {
      log.info(`[Scheduler] runtime '${this.runtimeName}' declares no event stream; skipping subscription`);
      return;
    }
    if (!this.runtime) {
      log.warn('[Scheduler] runtime not available; skipping event subscription');
      return;
    }
    // Cancel any existing subscription to prevent orphaned async iterators.
    if (this.eventStreamAbort) {
      this.eventStreamAbort.abort();
      this.eventStreamAbort = null;
    }
    const controller = new AbortController();
    this.eventStreamAbort = controller;
    try {
      // 方言感知（重）接线由 facade 在闭包内完成：RawRuntime 不出边界，
      // 重探测/重包保持幂等，业务核心只继续消费同一个 canonical 流。
      await this.runtime.rewireEvents();
      // Use /global/event (GlobalEvent = { directory, payload }) so we receive
      // events from ALL workspaces — /event only delivers the current
      // request-scoped workspace, missing sessions in other project dirs.
      const result = await this.runtime.global.event();
      // SDK SSE client returns { stream } where stream is an async generator
      const stream = result?.stream ?? result;
      if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') {
        log.warn('[Scheduler] SDK event subscribe returned no async stream');
        return;
      }
      log.info(`[Scheduler] Subscribed to runtime events (runtime=${this.runtimeName})`);
      const signal = controller.signal;
      void (async () => {
        try {
          for await (const evt of stream) {
            if (signal.aborted) break;
            this.handleRuntimeEvent(evt);
          }
          if (!signal.aborted) log.info('[Scheduler] Runtime event stream ended gracefully');
        } catch (err: any) {
          if (signal.aborted) return; // Expected during hot-switch
          log.warn(`[Scheduler] Runtime event stream ended: ${err.message}`);
        }
      })();
    } catch (err: any) {
      if (!controller.signal.aborted) {
        log.warn(`[Scheduler] SDK event subscribe failed (non-fatal): ${err.message}`);
      }
    }
  }

  /** Cancel existing event stream subscription and re-subscribe with the
   *  current runtime. Used by runtime switch and config hot-reload. */
  private async resubscribeEvents(reason: string) {
    log.info(`[Scheduler] Re-subscribing events: ${reason}`);
    await this.subscribeToEvents();
  }

  /** B2 守卫失败记录：限频 ERROR（30s per-runtime，isMalformedEvent 同模式）+ 计数。 */
  private recordTranslationError(runtime: string, kind: 'transformEvent' | 'normalizeMessages', reason: string): void {
    try {
      const now = Date.now();
      const cur = this.translationErrors.get(runtime) ?? { transformEvent: 0, normalizeMessages: 0 };
      cur[kind]++;
      cur.lastError = reason;
      cur.lastAt = new Date().toISOString();
      if (!cur.lastWarnAt || now - cur.lastWarnAt > 30_000) {
        cur.lastWarnAt = now;
        log.error(`[Runtime] translation error (${runtime}.${kind}): ${reason}`);
      }
      this.translationErrors.set(runtime, cur);
    } catch { /* fail-open */ }
  }

  /** B3 入口拦截计数：unmatched（监控信号）/ suppressed（声明式压制）；turn 终态 unmatched 每次 loud warn。 */
  private recordTranslationDrop(runtime: string, type: string, kind: 'unmatched' | 'suppressed'): void {
    try {
      const cur = this.translationDrops.get(runtime) ?? { unmatched: {}, suppressed: {} };
      cur[kind][type] = (cur[kind][type] ?? 0) + 1;
      this.translationDrops.set(runtime, cur);
      if (kind === 'unmatched') {
        if (type === 'turn.completed' || type === 'turn.failed' || type === 'turn.aborted') {
          log.warn(`[SSE] runtime '${runtime}' unmatched TERMINAL event '${type}' — turn pipeline broken (vocabulary drift? update eventMappings); this warns on EVERY occurrence`);
        } else {
          const { firstSeen } = this.unknownEventTracker.record(runtime, type);
          if (firstSeen) {
            log.warn(`[SSE] runtime '${runtime}' unmatched event type '${type}' — dropped (declare in eventMappings/transformEvent); counters: GET /api/runtime .translationDrops`);
          }
        }
      }
    } catch { /* fail-open */ }
  }

  private handleRuntimeEvent(evt: any): void {
    const f = normalizeOpencodeEvent(evt);
    // opencode v2 sync 信封：与 legacy 事件双发的状态重同步噪声，gateway
    // 边界丢弃（处置登记于 event-flow-matrix.ts RUNTIME_NATIVE_DROPPED）。
    // 放行会重复处理 + desktop miss 告警 + [SSE] 日志刷屏。
    if (RUNTIME_NATIVE_DROPPED.has(f.type)) return;
    // 工具三原语属 assembler 内部入口：正常路径已被 wrapToolPartAssembly 消费，
    // 漏到这里说明装配层未接线——丢弃防广播污染（tool part 只能以合成快照形态出站）。
    if (TOOL_PRIMITIVE_TYPES.has(f.type)) return;
    // 畸形事件诊断（限频）：runtime 插件发来的事件 type/properties 全空时
    // 静默穿过会污染 trajectory 与桌面 SSE——这里给可定位诊断。
    if (isMalformedEvent(evt)) {
      const now = Date.now();
      const last = this.malformedEventWarnAt.get(this.runtimeName) ?? 0;
      if (now - last > 30_000) {
        this.malformedEventWarnAt.set(this.runtimeName, now);
        let summary: string;
        try { summary = JSON.stringify(evt)?.slice(0, 200) ?? '(unserializable)'; } catch { summary = '(unserializable)'; }
        log.warn(`[SSE] malformed event from runtime '${this.runtimeName}' (no type/properties) — dropped consumers may misbehave; payload: ${summary}`);
      }
    }
    // 未知类型遥测（全量启用）：首次出现时 warn 一次给可定位诊断，
    // 计数经 GET /api/runtime 的 unknownEvents 暴露。fail-open 不阻断。
    if (!isKnownEventType(f.type)) {
      try {
        const { firstSeen } = this.unknownEventTracker.record(this.runtimeName, f.type);
        if (firstSeen) {
          log.warn(
            `[SSE] runtime '${this.runtimeName}' emitted unknown event type '${f.type}' ` +
            `(not canonical, not plugin:* namespaced) — desktop will show it as ` +
            `'miss' in the event inspector; counters: GET /api/runtime .unknownEvents`,
          );
        }
      } catch { /* fail-open */ }
    }
    const { type, properties: props, sessionID } = f;
    // 工具语义类别 enrich（additive 可选字段 part.toolClass + part.canonicalTool；
    // tool-classes.ts 单源——审批 read-only 档 / 身份类别 / 渲染四级查找链共用此维度）。
    // 单点 enrich 保证 eventTaps / trajectory / broadcast 全下游可见。
    try { enrichToolIdentity(evt); } catch { /* fail-open：enrich 绝不阻断事件链 */ }
    // Conformance event tap：per-session 临时观察者（POST /api/runtime/conformance 用）。
    // 放在 internal 过滤之前——tap 要看到该会话的全量事件（fail-open 不阻断主链）。
    if (sessionID) {
      const taps = this.eventTaps.get(sessionID);
      if (taps && taps.size) {
        const snap = { type: f.type, sessionID, at: Date.now(), ...(props?.part ? { part: props.part } : {}) };
        for (const t of taps) { try { t(snap); } catch { /* fail-open */ } }
      }
    }
    // Goal node listeners: NodeDriver 完成/失败双门的事件侧（spec §3）。
    // v2：turn.completed/turn.failed 是回合终态一等公民（opencode session.idle /
    // pi agent_end 经翻译层产出），双保险的 broadcast 切面已随 Mode A 改写删除。
    if (sessionID) {
      // 回合归属：本回合的活动水位。没有它，陈旧 idle 与真结束无法区分。
      if (
        type === MAFW.turnStarted ||
        type === MAFW.partUpdated ||
        type === MAFW.partDelta ||
        type === MAFW.messageUpdated
      ) {
        this.goalDriver?.noteSessionActivity(sessionID);
      }
      if (type === MAFW.turnCompleted) this.goalDriver?.onSessionIdle(sessionID);
      if (type === MAFW.turnFailed) {
        const rawError = (props as any)?.error;
        const code = typeof rawError === 'object' && rawError
          ? String(rawError.type ?? rawError.code ?? 'session_error')
          : String((props as any)?.errorCode ?? 'session_error');
        const message = typeof rawError === 'object' && rawError
          ? String(rawError.message ?? rawError.type ?? 'session error')
          : String(rawError ?? 'session error');
        this.goalDriver?.onSessionError(sessionID, message, code);
      }
      // busy 追踪（spec 2026-10-22-session-queue-inbox §5.1 v2）：turn.started 置位；
      // 本词汇的首个消费者——配对可靠性由 15min TTL 清扫兜底（防楔死，v2 Q2）。
      if (type === MAFW.turnStarted) {
        this.busySessions.set(sessionID, Date.now());
        this.runCoordinator?.onTurnStarted(sessionID);
      }
    }
    // Task 3：runtime shell 台账（synthetic / shell 生命周期经翻译层产出的 canonical
    // background.job.updated）。终态不回退；广播仍走下方统一出口（不重复发）。
    if (type === MAFW.backgroundJobUpdated) {
      const job = (props as any)?.job;
      if (job && typeof job === 'object') {
        try { this.backgroundShells.apply(job as any, { directory: f.directory }); } catch { /* fail-open */ }
      }
    }
    // Approval policy：asked 事件先于 internal 过滤与 Mode A 广播评估（内部会话
    // fail-safe 需在 memoryWorker drop 之前生效）；决策附在广播 properties.mafwPolicy，
    // 三端据此分流（非 human = 直接渲染已决记录，不弹交互卡）。
    if (f.approval && sessionID) {
      applyApprovalPolicy(this.approvalPolicy, this.runtime, f.approval, sessionID, props);
    }
    // 规范权限字段并入载荷（id/kind/targets/suggestedRule…）：asked 与 replied **同一投影**。
    // pi 的 `{requestId, toolName, args}` 与 opencode 的 `{id, permission, patterns}` 在出口
    // 收敛成同一张卡片（review I2：pi 卡片曾丢 id、只显示 "shell"）；replied 无工具元数据也
    // 必须带 canonical id（opencode v2 用 requestID），否则桌面/远端按 `requestID || id` 找
    // 不到卡、永远销账不掉。原生答复字段（approved/decision/message/reply）原样保留；
    // 审批策略与答复语义不变——这里只做投影。
    if ((type === MAFW.permissionAsked || type === MAFW.permissionReplied) && sessionID) {
      try { enrichPermissionEvent(props, sessionID); } catch { /* fail-open：卡片退回客户端兜底 */ }
    }
    // 问题载荷同样补规范字段（`questions[].question/options`）；原生 form 字段保留。
    if (type === 'question.asked' && sessionID) {
      try {
        const projected = projectQuestionRequest(props, sessionID);
        if (projected && typeof projected === 'object') Object.assign(props, projected);
      } catch { /* fail-open */ }
    }
    // Turn-level identity binding cleanup: a user-picked identity lasts one turn.
    if (type === MAFW.turnCompleted && sessionID) this.identityState.clearTurnBindings(sessionID);
    // T2-1：自动检查点（fail-open；门控在 runAutoCheckpoint 内——内部会话/隐藏会话/
    // 非 checkpointApi runtime 全跳过）。挂在 memoryWorker 早退之前，role 门兜底。
    if (type === MAFW.turnCompleted && sessionID) {
      void this.recordAutoCheckpoint(sessionID).catch((err: any) => {
        log.warn(`[Checkpoint] auto record failed for ${sessionID} (non-fatal): ${err?.message ?? err}`);
      });
    }
    // P0-2：per-prompt 预算 guard 回合终态清理（三终态；防上次预算泄漏到
    // 后续无预算 prompt。goal guard 不在此列——其生命周期是整个 goal）。
    if ((type === MAFW.turnCompleted || type === MAFW.turnFailed || type === MAFW.turnAborted) && sessionID) {
      if (this.promptBudgetSessions.delete(sessionID)) this.budgetGuards.delete(sessionID);
      // busy 清除 + 队列续发（每终态一条，fire-and-forget）
      this.busySessions.delete(sessionID);
      // T2-2：run 状态收尾/落定（resumed 才 finish；suspend 的 abort 终态只 settle）
      try {
        this.runCoordinator?.onTerminal(
          sessionID,
          type === MAFW.turnCompleted ? 'completed' : type === MAFW.turnFailed ? 'failed' : 'aborted',
        );
      } catch (err: any) {
        log.warn(`[Run] terminal handling failed for ${sessionID} (non-fatal): ${err?.message ?? err}`);
      }
      this.flushSessionQueue(sessionID);
    }
    // Only memory-system sessions (index-scan / extract / reflect workers) are
    // internal: their token-level deltas flooded the desktop renderer (per-delta
    // store writes + re-render storms froze the UI). Tiered policy for them:
    // token noise dropped; lifecycle events (idle/error) still broadcast, tagged
    // `internal`, so the UI can surface pipeline status. Every other session —
    // user chats AND manager goal sessions — passes through untouched.
    const role = sessionID ? this.internalSessionRoles.get(sessionID) : undefined;
    const memoryWorker = !!role && (role === 'index-scan' || role === 'extract' || role === 'reflect');
    if (memoryWorker && type !== MAFW.turnCompleted && type !== MAFW.turnFailed && type !== MAFW.turnAborted) return;
    // deltas are never logged for any session (per-token lines churned the 5MB log)
    if (type !== MAFW.partDelta) log.info(`[SSE] ${this.runtimeName} event: ${type} sessionID=${sessionID}`);

    // Caller-location bookkeeping for self-update: every event refreshes the
    // session's last-active stamp; tool events carrying a shell command that
    // touches the restart token file pin the exact session that wrote it.
    if (sessionID) {
      this.lastActiveBySession.set(sessionID, Date.now());
      // T2-2：长回合只要有事件就刷新 busy 时间戳（15min 清扫不得误删活跃回合）。
      if (this.busySessions.has(sessionID)) this.busySessions.set(sessionID, Date.now());
      if (f.toolCommand) {
        if (/pending-restart/i.test(f.toolCommand)) {
          this.tokenWriterSession = { sessionID, at: Date.now() };
        }
        this.lastWriteBySession.set(sessionID, { at: Date.now(), command: f.toolCommand });
      }
    }

    // Path T: trajectory accumulation — writes SQLite + broadcasts trajectory.event/trajectory.turn
    try {
      if (!memoryWorker) {
        const collector = this.trajectoryCollector;
        if (collector) {
          const trajEvt = collector.handleEvent(type, props, f.directory);
          if (trajEvt) {
            this.broadcast(mafwBroadcast({ type: MAFW.trajectoryEvent, properties: trajEvt, sessionID }, memoryWorker));
          }
        }
      }
    } catch (err: any) {
      log.warn(`[Trajectory] handle failed (non-fatal): ${err.message}`);
    }

    // Compaction flush: 会话压缩发生时把该 session 的 pending T1 回合立即喂给
    // turnCompress（fail-open；同 session 的 flush 在飞则跳过本轮）。Per-session
    // mutexKey 与 hourly cron 的 action key 不同，互不阻塞（pipeline 内部有
    // per-session runExclusive 兜底）。
    if (f.compaction && sessionID && !memoryWorker) {
      void this.scheduler
        .submit(
          {
            id: `compact-flush:${sessionID}`,
            priority: 'background',
            mutexKey: `compact-flush:${sessionID}`,
            strategy: 'skip',
            timeoutMs: 30 * 60_000,
          },
          async () => {
            try {
              const pipeline = this.getTurnPipeline();
              const res = await pipeline.runSession(sessionID);
              if (res.turns > 0) {
                log.info(`[TurnPipeline] compaction flush session=${sessionID} turns=${res.turns} archived=${res.archived}`);
                this.scanService?.refreshCache();
              }
            } catch (err: any) {
              log.warn(`[TurnPipeline] compaction flush failed (non-fatal): ${err.message}`);
            }
          },
        )
        .catch((err) => {
          if (err instanceof TaskSkippedError) {
            log.info(`[TurnPipeline] compaction flush ${sessionID} skipped: previous flush in flight`);
            return;
          }
          if (err instanceof TaskTimeoutError) {
            log.warn(`[TurnPipeline] compaction flush ${sessionID} watchdog timeout`);
            return;
          }
          log.warn(`[TurnPipeline] compaction flush ${sessionID} submit failed (non-fatal): ${err instanceof Error ? err.message : err}`);
        });
    }

    // BudgetGuard: goal-session turn/cost hard stop (turnBudgetApi-lacking
    // runtimes). Guard auto-detonates once → detach.
    if (f.step && sessionID) {
      const guard = this.budgetGuards.get(sessionID);
      if (guard) {
        guard.onStep();
        if (guard.triggered) this.budgetGuards.delete(sessionID);
      }
    }

    // Per-session SSE (Mode B) forwarding
    if (sessionID && this.chatSessions.hasListeners(sessionID)) {
      if (f.chatSignal === 'delta' && f.deltaText) {
        this.chatSessions.pushDelta(sessionID, f.deltaText);
      } else if (f.chatSignal === 'complete') {
        this.chatSessions.pushComplete(sessionID);
      } else if (f.chatSignal === 'error') {
        this.chatSessions.pushError(sessionID, String(f.chatError || 'Unknown error'));
      }
    }

    // Global broadcast (Mode A — used by the desktop renderer).
    // v2：Mode A 改写 hack（session.idle→message.complete / session.error→
    // message.error）已删除——turn.completed/turn.failed 是词汇一等公民，翻译层
    // 直接产出；回合聚合与 usage 合成挂在 turn.completed，广播统一 passthrough。
    if (type === MAFW.turnCompleted && sessionID) {
      try {
        if (this.trajectoryCollector) {
          const turn = this.trajectoryCollector.onIdle(sessionID);
          if (turn) {
            this.broadcast(mafwBroadcast({ type: MAFW.trajectoryTurn, properties: turn, sessionID }, memoryWorker));
            // v2 增量：usage.updated 从回合聚合合成（tokens/cost 汇总；Tier 0 之外
            // 的可选组，desktop UsagePill 事件化消费留后续，轮询保留兜底）。
            if (turn.tokens || turn.cost) {
              this.broadcast(mafwBroadcast({
                type: MAFW.usageUpdated,
                properties: { tokens: turn.tokens, cost: turn.cost, model: turn.model, provider: turn.provider, turnID: turn.turnID },
                sessionID,
              }, memoryWorker));
            }
          }
        }
      } catch (err: any) {
        log.warn(`[Trajectory] turn aggregation failed (non-fatal): ${err.message}`);
      }
    }
    // turn.failed 保留 error 字段提取（消费方错误展示的 wire 契约）；其余 passthrough。
    const errorText = type === MAFW.turnFailed
      ? (props?.error instanceof Error ? props.error.message : String(props?.error ?? 'Unknown error'))
      : undefined;
    this.broadcast(mafwBroadcast(
      {
        type, properties: props, sessionID,
        directory: f.directory,
        ...(errorText !== undefined ? { error: errorText } : {}),
      },
      memoryWorker,
    ));
  }

  /** Surface 门：业务路由不再自行解释 capability / 方法存在性。 */
  private capGuard(res: http.ServerResponse, surface: string): boolean {
    if (this.runtime?.access.can(surface)) return false;
    res.writeHead(503);
    res.end(JSON.stringify({ error: `runtime surface '${surface}' is not available` }));
    return true;
  }

  /** Question 通道门：兼容仅声明 legacy nativeApprovals 的 runtime。 */
  private capGuardQuestion(res: http.ServerResponse): boolean {
    const legacyQuestion = this.runtimeCaps.questionApi === undefined && !!this.runtimeCaps.nativeApprovals;
    if (this.runtime?.access.can('approval.question.list') || legacyQuestion) return false;
    res.writeHead(503);
    res.end(JSON.stringify({ error: "runtime surface 'approval.question.list' is not available" }));
    return true;
  }

  /**
   * 激活期"声明 vs 实现"校验：hard → 抛错（调用方回退内置）；downgraded/warnings
   * 记录进 runtimeValidationNotes（GET /api/runtime 可见）并打日志。
   * fatal=false 用于内置件——兜底不能再回退，只降级+暴露。
   */
  private applyRuntimeValidation(
    rt: AgentRuntime,
    source: string,
    fatal: boolean,
    subject?: Omit<ContractSubject, 'rt'> & { declaredCapabilityKeys?: string[] },
  ): void {
    const v: RuntimeValidation = validateRuntime(rt, source, subject);
    this.runtimeValidationNotes = [...v.downgraded, ...v.warnings];
    this.runtimeCoverage = v.staticCoverage ?? null;
    for (const d of v.downgraded) log.error(`[Runtime] capability downgraded: ${d}`);
    for (const w of v.warnings) log.warn(`[Runtime] ${w}`);
    if (v.hard.length > 0) {
      for (const issue of v.hard) log.error(`[Runtime] shape violation: ${issue}`);
      if (fatal) {
        throw new Error(`runtime '${rt.name}' failed shape validation (${v.hard.length} issue(s)) — see logs`);
      }
    }
  }

  /**
   * 会话 cwd 与插件 ctx 默认值的唯一解析点：UI 当前项目优先，否则 config 项目根（绝对）。
   * 见 spec docs/superpowers/specs/2026-10-20-session-directory-contract-design.md
   */
  private resolvedProjectDir(): string {
    return resolvePluginProjectDir(this.currentProjectDir, config.raw.paths.projectDir);
  }

  /** Runtime server 启动根（规范单一来源）：`~/.mafw/runtime-root`。
   *  只用于 server 进程/插件 server 初始化，不参与 session cwd。 */
  private ensureRuntimeRootDir(): string {
    if (!this.runtimeRootDir) {
      this.runtimeRootDir = ensureRuntimeRoot(resolveRuntimeRoot());
      log.info(`[Runtime] server root: ${this.runtimeRootDir}`);
    }
    return this.runtimeRootDir;
  }

  /**
   * 组合根诊断快照：唯一允许读取 runtime.name / capabilities 的位置（设计 §7.1）。
   * 诊断视图从组合根持有的 RuntimeHost 构建（facade 不再暴露这些字段）；
   * 业务模块不直接读门面上的身份/能力。
   */
  private adoptRuntimeHost(host: RuntimeHost, facade: RuntimeFacade): RuntimeFacade {
    // 记录切换前的 runtime 名（热切换广播用；诊断视图随即指向新 host）。
    this.runtimeNameBeforeSwitch = this.runtimeDiagnostics?.name ?? null;
    this.runtimeHost = host;
    this.runtimeDiagnostics = buildRuntimeDiagnostics(host);
    if (this.runtimeDiagnostics) this.runtimeName = this.runtimeDiagnostics.name;
    return facade;
  }

  private setRuntimeDiagnostics(): void {
    this.runtimeDiagnostics = this.runtimeHost ? buildRuntimeDiagnostics(this.runtimeHost) : null;
    if (this.runtimeDiagnostics) {
      this.runtimeName = this.runtimeDiagnostics.name;
    }
  }

  /**
   * 契约无状态补全通道（surface 门 `process.completion`；thunk 现读，热切换安全）。
   * 业务/管线不得直接读 capabilities.completionApi —— 统一经 RuntimeAccess。
   */
  private runtimeCompletionChannel(): CompletionChannel | undefined {
    const runtime = this.runtime;
    if (!runtime?.access.can('process.completion')) return undefined;
    return this.runtimeHost?.completion;
  }

  /**
   * Runtime 选择（D 收敛）：单查找路径——config.runtime.plugin 缺省 'opencode'
   * （loader 注册表成员，文件>包>内置统一优先级）；失败/缺失回退 opencode；
   * 两级都失败时抛中性错误，不再直连 adapter。
   */
  private async createRuntime(): Promise<RuntimeFacade> {
    const wanted = config.runtime?.plugin || 'opencode';
    const rt = await this.activatePluginRuntime(wanted, true);
    if (rt) return rt;
    if (wanted !== 'opencode') {
      log.warn(`[Runtime] plugin '${wanted}' unavailable — falling back to opencode`);
      const fallback = await this.activatePluginRuntime('opencode', false);
      if (fallback) return fallback;
    }
    // No direct adapter fallback: the definition registry is the only entry.
    throw noRuntimeRegisteredError(wanted);
  }

  /** 单激活路径（D 收敛）：plugin/builtin/package 同一序列。fatal=true 时校验失败抛错触发回退。 */
  private async activatePluginRuntime(name: string, fatal: boolean): Promise<RuntimeFacade | null> {
    const plugin = this.runtimeLoader?.get(name);
    const creds = name === 'opencode' ? undefined : await this.runtimeCredentialsForPlugin();
    const ctx = createRuntimePluginContext(creds, {
      projectDir: this.resolvedProjectDir(),
      rootDir: this.ensureRuntimeRootDir(),
      gatewayPort: config.server.apiPort,
      policy: this.runtimePolicyHooks(),
    });

    // Neutral path: a registered definition is the only entry. The legacy
    // `createRuntime` remains for legacy plugin files for one release.
    let definition: RuntimeDefinition | undefined;
    try {
      definition = await this.runtimeLoader?.resolveBuiltinDefinition(name, ctx);
    } catch (err: any) {
      log.warn(`[Runtime] '${name}' definition failed: ${err?.message ?? err}${fatal ? ' — falling back' : ''}`);
    }
    if (definition) return this.activateNeutralRuntime(name, definition, fatal);

    if (!plugin) return null;
    try {
      const rawRuntime = await plugin.createRuntime(ctx);
      // 能力声明单源（G3）：module.exports.capabilities 为准；实例若自带且不一致 →
      // log.error 后仍以模块声明覆盖（普通可写赋值，激活期降级路径继续可写）。
      const capabilityMismatch = stampDeclaredCapabilities(rawRuntime, plugin.capabilities);
      if (capabilityMismatch) {
        log.error(`[Runtime] '${rawRuntime.name}': ${capabilityMismatch}`);
        this.runtimeLoader?.markError(name, capabilityMismatch);
      }
      // B1 D2 兜底：包贡献 runtime 不经 loader.loadFile 的无声明降级路径。
      // 必须在 applyRuntimeValidation 之前——否则 coverage 会记录降级前的
      // eventStream=true，与 active.capabilities 自相矛盾。
      // 判定矩阵归 event-declaration 单源（declared / self 逃逸）。
      const declaration = resolveEventDeclaration(rawRuntime.capabilities, plugin);
      if (!declaration.eventStream) (rawRuntime as any).capabilities.eventStream = false;
      for (const issue of declaration.issues) {
        log.error(`[Runtime] '${rawRuntime.name}': ${issue}`);
      }
      // 声明 vs 实现一致性校验：必选面缺失 → 回退（fatal）；能力位虚报 → 强制降级
      // （写回 capabilities 拷贝），缺口在激活期可见而非运行时深处才炸。
      this.applyRuntimeValidation(rawRuntime, name, fatal, {
        declaration: {
          eventSource: plugin.eventSource,
          eventMappings: plugin.eventMappings,
          transformEvent: plugin.transformEvent,
          eventTranslation: plugin.eventTranslation,
        },
        plugin: {
          name,
          createRuntime: plugin.createRuntime,
          external: plugin.external,
          capabilities: plugin.capabilities,
        },
        dialect: rawRuntime.activeDialect,
        source: 'active',
        declaredCapabilityKeys: plugin.declaredCapabilityKeys,
      });
      // 工具注册通道接线（Tier-0）：推送六件套 factory + nativeTools → 类别 overlay
      await activateRuntimeTools(rawRuntime, name, { baseUrl: `http://127.0.0.1:${config.server.apiPort}` });
      log.info(`[Runtime] using runtime '${rawRuntime.name}' (${name}, capabilities: ${JSON.stringify(rawRuntime.capabilities)})`);
      const wrapped = this.wrapRuntimeIdentity(rawRuntime);
      // Runtime Ingress：翻译、合帧与 RawRuntime 全部留在 facade 闭包内；
      // 业务核心从返回值起只看到 canonical 面。
      const facade = await createRuntimeFacade(wrapped, {
        entry: plugin,
        isCanonical: (t) => CANONICAL_TYPE_SET.has(t),
        hooks: {
          onUnmatched: (t) => this.recordTranslationDrop(rawRuntime.name, t, 'unmatched'),
          onSuppressed: (t) => this.recordTranslationDrop(rawRuntime.name, t, 'suppressed'),
          onTranslationError: (_raw, reason) => this.recordTranslationError(rawRuntime.name, 'transformEvent', reason),
          onNoMappings: () => {
            log.warn(
              `[Runtime] '${rawRuntime.name}' declares no event mappings/transformEvent — ` +
              `eventStream should have been downgraded`,
            );
          },
        },
        onHistoryViolation: (reason) => this.recordTranslationError(rawRuntime.name, 'normalizeMessages', reason),
      });
      return this.adoptRuntimeHost(wrapped, facade);
    } catch (err: any) {
      log.warn(`[Runtime] '${name}' createRuntime failed: ${err.message}${fatal ? ' — falling back' : ''}`);
      return null;
    }
  }

  /** Gateway 交给 driver 的中性策略钩子（审批 / 认知门 / 结果脱敏）。 */
  private runtimePolicyHooks(): import('@mafw/runtime-contract').RuntimePolicyHooks {
    return {
      evaluatePermission: (sessionID, candidate) => {
        try { return this.approvalPolicy.evaluate(sessionID, candidate as any); } catch { return null; }
      },
      gateToolCall: (sessionID, payload) => this.cognitionGate.gateToolCall(sessionID, payload),
      gatePrompt: (sessionID, text) => this.cognitionGate.gatePrompt(sessionID, text),
      redactToolResult: (sessionID, tool, content) => this.cognitionGate.applyToolResultRedact(sessionID, tool, content as any),
    };
  }

  /** 中性 runtime 激活：definition → AgentRuntime → 校验/工具/身份 → facade。 */
  private async activateNeutralRuntime(
    name: string,
    definition: RuntimeDefinition,
    fatal: boolean,
  ): Promise<RuntimeFacade | null> {
    try {
      const rawRuntime = createNeutralRuntime(definition, {
        bus: this.runtimeLoader!.getRuntimeBus(),
        host: {
          getBaseUrl: () => `http://127.0.0.1:${config.server.apiPort}`,
        },
      });
      this.applyRuntimeValidation(rawRuntime, name, fatal, {
        declaration: getBridgeEventEntry(name) ?? { eventTranslation: 'self' },
        plugin: {
          name,
          createRuntime: () => {},
          external: definition.external ?? false,
          capabilities: rawRuntime.capabilities,
        },
        source: 'active',
        declaredCapabilityKeys: Object.keys(rawRuntime.capabilities),
      });
      await activateRuntimeTools(rawRuntime, name, { baseUrl: `http://127.0.0.1:${config.server.apiPort}` });
      log.info(`[Runtime] using neutral runtime '${definition.name}' (${name})`);
      const wrapped = this.wrapRuntimeIdentity(rawRuntime);
      const facade = await createRuntimeFacade(wrapped, {
        neutral: true,
        entry: { eventTranslation: 'self' },
        isCanonical: (t) => CANONICAL_TYPE_SET.has(t),
        hooks: {
          onUnmatched: (t) => this.recordTranslationDrop(definition.name, t, 'unmatched'),
          onSuppressed: (t) => this.recordTranslationDrop(definition.name, t, 'suppressed'),
          onTranslationError: (_raw, reason) => this.recordTranslationError(definition.name, 'transformEvent', reason),
        },
        onHistoryViolation: (reason) => this.recordTranslationError(definition.name, 'normalizeMessages', reason),
      });
      return this.adoptRuntimeHost(wrapped, facade);
    } catch (err: any) {
      log.warn(`[Runtime] neutral '${name}' activation failed: ${err.message}${fatal ? ' — falling back' : ''}`);
      return null;
    }
  }

  /** 物化循环：遍历注册表 install；成功与否记入 IdentityState（驱动车道选择）。幂等可重跑（热切换后重物化）。 */
  private async materializeIdentities(): Promise<void> {
    const runtime = this.runtime;
    const host = this.runtimeHost;
    if (!runtime || !host) return;
    this.identityState.resetMaterialization(host.name);
    // 能力门经 surface（identity.agents.install = agentConfigApi + agents.install）。
    if (runtime.access.can('identity.agents.install') && runtime.agents?.install) {
      const caps = this.runtimeCaps;
      for (const spec of this.identityRegistry.list()) {
        // 身份自身依赖的能力未声明（如 pi 上没有 Creator 的插件工具/技能）：
        // 不物化并记 false —— /api/agents 过滤它，Desktop 落到中性的无 Agent 态。
        if (!identityMaterializable(spec, caps)) {
          this.identityState.setMaterialized(host.name, spec.name, false);
          log.info(
            `[Identity] skip '${spec.name}' on runtime '${host.name}' — requires ${spec.requiresCapability}`,
          );
          continue;
        }
        try {
          await runtime.agents.install(spec.name, toAgentDefinition(spec));
          this.identityState.setMaterialized(host.name, spec.name, true);
          log.info(`[Identity] materialized '${spec.name}' on runtime '${host.name}'`);
        } catch (err: any) {
          this.identityState.setMaterialized(host.name, spec.name, false);
          log.warn(`[Identity] materialize '${spec.name}' failed (non-fatal): ${err.message}`);
        }
      }
    } else {
      log.info(`[Identity] runtime '${host.name}' has no agentConfigApi — identities run via gateway policy layer (lane 2/3)`);
    }
  }

  /** T2-4: one renderer shared by prompt-time sync and the fallback endpoint. */
  private async buildInstructionBlocks(): Promise<InstructionBlocks> {
    const { handleRecallPinned } = require('./routes/pinned-recall');
    const { handleAgentPriors } = require('./routes/agent-priors');
    return renderInstructionBlocks({
      getPinnedProfile: async () => {
        if (!this.memoryService) return null;
        const { HarmonicUnitFileStore } = require('./memory/harmonic-file-store.js');
        const store = new HarmonicUnitFileStore(config.resolvePath(), this.memoryService.harmonicIndex);
        const result = await handleRecallPinned({
          getIndex: () => this.memoryService!.harmonicIndex.getIndex(),
          readUnit: (id: string) => store.read(id),
        });
        return result.profile ?? null;
      },
      getAgentPriors: async () => {
        const result = await handleAgentPriors({
          l5: new L5Store(),
          getIndex: () => this.memoryService?.harmonicIndex.getIndex() ?? { entries: [] },
          needFor: (id: string) => getRetrievalEventBuffer().needFor(id),
        });
        return result.block ?? null;
      },
    });
  }

  private ensureInstructionSync(): InstructionSyncService {
    if (!this.instructionSync) {
      this.instructionSync = new InstructionSyncService({
        render: () => this.buildInstructionBlocks(),
        getRuntime: () => this.runtime,
        getAccess: () => this.runtime?.access ?? null,
        isEnabled: () => config.recall.instructions?.enabled !== false,
        log: { info: (msg) => log.info(msg), warn: (msg) => log.warn(msg) },
      });
    }
    return this.instructionSync;
  }

  private getDiscoveryService(): DiscoveryService {
    if (!this.discovery) {
      this.discovery = new DiscoveryService({
        getRuntime: () => this.runtime,
        getAccess: () => this.runtime?.access ?? null,
        getMafwCommands: () => this.getMafwCommandRegistry().list(),
        resolveDirectory: async (sessionID, provided) => {
          if (provided) return provided;
          const rt = this.runtime;
          if (!rt) return null;
          const info = await rt.session.get({ sessionID }).catch(() => null);
          return (info as any)?.directory ?? (info as any)?.location?.directory ?? null;
        },
        broadcast: (e) => this.broadcast(mafwBroadcast(e as any)),
        gatewayProjectDir: this.projectDir,
        mafwDir: this.mafwDir,
        homeDir: os.homedir(),
        globalConfigDir: path.join(os.homedir(), '.config', 'opencode'),
      });
    }
    return this.discovery;
  }

  /** 包装 runtime 的 prompt 面：按绑定+物化状态注入/剥离 agent 参数（物化车道 1 执行点）。 */
  private wrapRuntimeIdentity(rawRuntime: AgentRuntime): AgentRuntime {
    // 历史消息归一收口：声明 normalizeMessages 的 runtime 在 session.messages 出口
    // 统一转 MAFW flat DTO（所有消费者形状一致）。必须先于身份包装。
    // 历史归一由 RuntimeFacade 在 Ingress 出口完成；这里不得再包一次，
    // 否则 pi/claude 的声明式 normalizeMessages 会被二次执行并损坏历史。
    this.ensureInstructionSync().reset();
    const synced = withInstructionSync(rawRuntime.session as any, (sid) => this.instructionSync!.sync(sid));
    const registry = this.identityRegistry;
    (rawRuntime.session as any) = withIdentityPrompt(
      synced as any,
      this.identityState,
      () => rawRuntime.name,
      (n: string) => !!registry.get(n),
      // 队列拦截咽喉（spec §5.3 v2 Q1）：显式 opt-in——仅 delivery:'queue' 且 busy 时入队，
      // 其余（含 conformance/eval/media harness 的普通调用）零影响。
      (opts: any) => this.interceptQueuePrompt(opts),
    );
    return rawRuntime;
  }

  /** 队列拦截判定：busy + 显式 queue 交付 → 入队短路；否则 undefined 透传。 */
  private interceptQueuePrompt(opts: any): Promise<unknown> | undefined {
    if (!opts || opts.delivery !== 'queue' || typeof opts.sessionID !== 'string') return undefined;
    if (!this.busySessions.has(opts.sessionID)) return undefined;
    return this.enqueueQueuedPrompt(
      {
        sessionID: opts.sessionID,
        ...(opts.text !== undefined ? { text: opts.text } : {}),
        ...(Array.isArray(opts.parts) ? { parts: opts.parts } : {}),
        ...(opts.agent ? { agent: opts.agent } : {}),
        ...(opts.model ? { model: opts.model } : {}),
        ...(opts.expectReply !== undefined ? { expectReply: opts.expectReply } : {}),
        ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
        ...(opts.thinkingLevel ? { thinkingLevel: opts.thinkingLevel } : {}),
        ...(opts.variant ? { variant: opts.variant } : {}),
      },
      typeof opts.source === 'string' ? opts.source : 'runtime',
    );
  }

  /** 入队编排（spec §5.2/§5.3）：幂等 duplicate 透传；上限 throw 400 形错（HTTP 层转译）。
   *  事件发射（queue.updated）在 Task 5 接线——本版 log 占位。 */
  private async enqueueQueuedPrompt(
    opts: { sessionID: string; text?: string; parts?: any[]; agent?: string; model?: any; idempotencyKey?: string; expectReply?: boolean; thinkingLevel?: string; variant?: string },
    source: string,
  ): Promise<{ queued: true; itemId: string; position: number } | { queued: true; duplicate: true; itemId: string }> {
    const r = this.sessionQueue.enqueue(opts.sessionID, {
      ...(opts.text !== undefined ? { text: opts.text } : {}),
      ...(Array.isArray(opts.parts) ? { parts: opts.parts } : {}),
      ...(opts.agent ? { agent: opts.agent } : {}),
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.expectReply !== undefined ? { expectReply: opts.expectReply } : {}),
      ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
      ...(opts.thinkingLevel ? { thinkingLevel: opts.thinkingLevel } : {}),
      ...(opts.variant ? { variant: opts.variant } : {}),
      source,
    });
    if ('duplicate' in r) {
      log.info(`[Queue] duplicate idempotent enqueue for ${opts.sessionID} (key=${opts.idempotencyKey ?? '-'})`);
      return { queued: true, duplicate: true, itemId: r.duplicate.id };
    }
    if ('rejected' in r) {
      throw Object.assign(new Error('session queue limit reached (32)'), { statusCode: 400 });
    }
    log.info(`[Queue] enqueued ${r.item.id} for ${opts.sessionID} (source=${source}, size=${this.sessionQueue.size(opts.sessionID)})`);
    this.emitQueueUpdated(opts.sessionID, 'enqueue', this.sessionQueue.list(opts.sessionID), r.item.id);
    return { queued: true, itemId: r.item.id, position: this.sessionQueue.size(opts.sessionID) };
  }

  /** queue.updated 广播（spec §5.5）：items 全量快照（UI 单事件自足）；
   *  经 broadcast → event_log 持久化（骑回放地基，C8）。 */
  private emitQueueUpdated(
    sessionID: string,
    action: 'enqueue' | 'dequeue' | 'cancel' | 'clear' | 'expire',
    items: unknown[],
    itemId?: string,
  ): void {
    this.broadcast(mafwBroadcast({
      type: MAFW.queueUpdated,
      properties: { sessionID, items, action, ...(itemId ? { itemId } : {}) },
      sessionID,
    }, false));
  }

  /** 回合终态续发（spec §5.4）：每终态一条（串行）；fire-and-forget——pi promptAsync
   *  在 idle 会话 await 到回合结束，事件处理器内 await 会互锁（C3）。
   *  终审 #1：改经 this.runtime.session.promptAsync 对象形参直发——identity 包装代理
   *  仍在（apply 照跑、无 delivery 不触发拦截），且对象形参能携带 expectReply
   *  （facade 位置形参会丢该字段——BudgetGuard/milestone 的 noReply 通知必须保全）。 */
  private flushSessionQueue(sessionID: string): void {
    // T2-2：暂停中 / resume 等待回合启动时不续发（防延迟 abort 终态续命暂停）。
    if (this.runCoordinator?.shouldHoldQueue(sessionID)) return;
    const item = shouldFlush(this.sessionQueue, this.busySessions, sessionID);
    if (!item) return;
    log.info(`[Queue] flushing ${item.id} for ${sessionID} (remaining=${this.sessionQueue.size(sessionID)})`);
    this.emitQueueUpdated(sessionID, 'dequeue', this.sessionQueue.list(sessionID), item.id);
    const sendOpts: any = {
      sessionID,
      parts: Array.isArray(item.parts) && item.parts.length > 0
        ? item.parts
        : [{ type: 'text', text: item.text ?? '' }],
      ...(item.agent ? { agent: item.agent } : {}),
      ...(item.model ? { model: item.model } : {}),
      ...(item.expectReply !== undefined ? { expectReply: item.expectReply } : {}),
      ...(item.thinkingLevel ? { thinkingLevel: item.thinkingLevel } : {}),
      ...(item.variant ? { variant: item.variant } : {}),
    };
    void this.runtime!.session.promptAsync(sendOpts).catch((err: any) => {
      log.warn(`[Queue] flush send failed for ${item.id} (non-fatal): ${err?.message ?? err}`);
      // 终审 #3：flush 失败重入队（队首）而非静默丢——里程碑/预算通知的 markNotified
      // 已在 enqueue ack 时落盘，丢失即永久（dedupe key 挡住重发）。重入队保底一次投递。
      const requeued = this.sessionQueue.requeueHead(sessionID, item);
      if (requeued) {
        log.info(`[Queue] item ${item.id} re-queued at head for retry`);
        this.emitQueueUpdated(sessionID, 'enqueue', this.sessionQueue.list(sessionID), item.id);
      }
    });
  }

  /**
   * 插件 ctx 的凭据来源：active runtime credentials 快照 → opencode auth.json 回退。
   * 首次激活（runtimeHost 尚未建立）也必须拿得到 key——旧 pi 驱动自己读
   * auth.json，抽成外部 adapter 后只认 ctx.credentials，这里补上同一条链。
   *
   * 快照必须在构造时取值：新 runtime 被 adopt 后，runtimeHost.credentials 可能
   * 反过来委托给这个对象（pi definition 的 host.credentials），惰性读会自递归。
   */
  private async runtimeCredentialsForPlugin(): Promise<RuntimeCredentials | undefined> {
    return createPluginCredentials(this.runtimeHost?.credentials);
  }

  /** 凭据单点接线（Plan 3 终审 #10）：active runtime credentials → legacy auth.json → null。
   *  全部消费方构造点的唯一凭据来源——链变更只改这里。 */
  private runtimeGetApiKey(provider: string): string | null {
    return getProviderApiKey(provider, undefined, this.runtimeHost?.credentials) ?? null;
  }

  // ── Memory pipelines (turn compress / reflection) ───────────────────────

  private registerInternalSession(sessionId: string, role: string, identity?: string): void {
    this.internalSessionRoles.set(sessionId, role);
    this.getGatewayDb().kvSet('internal-session', sessionId, { role, at: new Date().toISOString() });
    if (identity) this.identityState.bind(sessionId, identity, 'session');
  }

  private unregisterInternalSession(sessionId: string): void {
    this.internalSessionRoles.delete(sessionId);
    this.getGatewayDb().kvDelete('internal-session', sessionId);
    this.identityState.unbind(sessionId);
  }

  /** Retired Leads stay readable as ordinary history, never as current Lead candidates. */
  private async archiveLeadSession(sessionId: string): Promise<void> {
    try {
      await this.sdkSession.updateMetadata(sessionId, { mafw: { role: 'lead-archived' } });
    } catch (err: any) {
      log.warn(`[Lead] archived metadata update failed for ${sessionId} (non-fatal): ${err?.message ?? err}`);
    }
    this.unregisterInternalSession(sessionId);
    // Phase C (final review I2): every archive entry point (rotation downgrade,
    // pod manager dep, dead-row cleanup) converges here — drop the kind 'lead'
    // process-table record too, or it survives as a TTL-less zombie.
    this.leadSessionRegistry?.unmirrorLeadSession(sessionId);
    // stale slot 清理：归档后不得再被 findBySessionId/current 认领（不依赖 rotation 恰好写完新槽）。
    try {
      const rows = this.getGatewayDb().kvAll<unknown>('manager-session');
      for (const row of clearSlotsForSession(rows, sessionId, this.runtimeName)) {
        this.getGatewayDb().kvSet('manager-session', row.key, row.value);
      }
    } catch (err: any) {
      log.warn(`[Lead] archived slot cleanup failed for ${sessionId} (non-fatal): ${err?.message ?? err}`);
    }
  }

  private getPool(): SessionWorkerPool {
    if (!this.workerPool) {
      if (!this.runtime) throw new Error('runtime not available');
      this.workerPool = new SessionWorkerPool({
        client: this.runtime,
        directory: this.resolvedProjectDir(),
        ttlMs: config.recall.sessionWorkerTtlMs,
        compactIdleMs: config.recall.workerCompactIdleMs,
        promptTimeoutMs: config.recall.workerPromptTimeoutMs,
        // Phase C: worker sessions register in the gateway's process table.
        registry: this.sessionRegistry,
        // Recursion guard (A): internal worker sessions are registered so
        // /api/obs/capture never records their output as observations.
        onSessionCreated: (sessionId, role) => {
          // Worker sessions run as the memory-curator identity (registration is
          // the session-binding point; prompt assembly by lane is automatic).
          this.registerInternalSession(sessionId, role, 'memory-curator');
        },
      });
    }
    return this.workerPool;
  }

  /** (Re)build the embedding runtime + consolidation service from current
   *  config. Re-entrant: kills the old llama-server sidecar and drops the old
   *  provider before rebuilding, so /api/memory/embedding-config can hot-swap
   *  engines without a gateway restart. */
  private initEmbeddingServices(mafwDir: string): void {
    const old = getEmbeddingRuntime();
    if (old && typeof (old.provider as any).killServer === 'function') {
      try { (old.provider as any).killServer(); } catch { /* best effort */ }
    }
    setEmbeddingRuntime(null);
    this.consolidationService = null;

    // P1: dense embedding runtime (opt-in via memory.embedding.provider).
    // Fires on every memory write (static listener) — BM25 stays instant,
    // vectors converge asynchronously; all failures degrade to BM25-only.
    const embeddingRuntime = initEmbeddingRuntime({
      getApiKeyFn: this.runtimeGetApiKey.bind(this),
      baseDir: mafwDir,
      getTextForId: async (id) => {
        try {
          const u = await new HarmonicUnitFileStore(mafwDir).read(id);
          return u ? EmbeddingIndexer.documentText(u) : null;
        } catch { return null; }
      },
    });
    if (!embeddingRuntime) return;

    // P2: Memora-style consolidation (embedding recall + LLM UPDATE/CREATE).
    // Judge model: `recall.judgeModel` (falls back to workerModel). It must be
    // a provider the stateless completion channel can resolve — a baseURL plus
    // an API key in auth.json. `opencode/*-free` has neither (its quota is
    // session-bound), which silently killed the judge for two weeks.
    if (config.memory.embedding.consolidation) {
      const judgeModel = resolveJudgeModel(config.recall);
      const providerID = judgeModel?.providerID;
      const modelID = judgeModel?.modelID;
      const judgeBaseUrl = providerID ? resolveScanBaseUrl(providerID) : undefined;
      const judgeApiKey = judgeBaseUrl ? getProviderApiKey(providerID!) : null;
      // Judge transport: prefer the runtime's stateless completion channel
      // (thunk — resolves inline-defined providers like "gateway" via opencode
      // provider config, hot-swap safe), fall back to direct HTTP. Gated by the
      // `process.completion` surface; do NOT probe it here — this runs before
      // this.runtime exists.
      const completion = () => this.runtimeCompletionChannel();
      const direct = Boolean(judgeBaseUrl && judgeApiKey);
      // Laya conflict cascade (one-sided v1): spawn sidecar when provisioned;
      // cascade is inert otherwise (fail-open to the LLM judge).
      const layaCfg = (config.memory.embedding as any).laya;
      let layaDeps: import("./memory/consolidation-service").ConsolidationDeps['laya'] | undefined;
      if (layaCfg?.enabled) {
        const layaHome = path.join(os.homedir(), '.mafw', 'laya');
        const layaPy = path.join(layaHome, '.venv', 'Scripts', 'python.exe');
        const layaScript = path.join(layaHome, 'laya-serve-conflict.py');
        if (fs.existsSync(layaPy) && fs.existsSync(layaScript)) {
          this.startLayaSidecar(layaPy, layaScript, layaCfg);
          layaDeps = {
            client: new LayaConflictClient({ url: layaCfg.url }),
            tauHigh: layaCfg.tauHigh ?? 0.99, // 0.99 = adoption gated off until calibrated from real pairs
            tauLow: layaCfg.tauLow ?? 0,      // 0 = three-way gate off until calibrated
          };
          log.info(`[Laya] conflict cascade enabled (tauHigh=${layaDeps.tauHigh}, tauLow=${layaDeps.tauLow}, url=${layaCfg.url})`);
        } else {
          log.info('[Laya] sidecar not provisioned (~/.mafw/laya) — cascade inert; provision via gateway/scripts/setup-laya-venv.ts');
        }
      }
      // Hoist for write-phase routing (setRouteWriteDeps in initServices) —
      // undefined when disabled/unprovisioned, keeping the gate skipped.
      this.layaDeps = layaDeps;
      this.consolidationService = new ConsolidationService({
        store: new HarmonicUnitFileStore(mafwDir, this.memoryService?.harmonicIndex),
        vectors: embeddingRuntime.vectors,
        provider: embeddingRuntime.provider,
        llm: judgeBaseUrl && judgeApiKey
          ? { baseUrl: judgeBaseUrl, apiKey: judgeApiKey, model: modelID! }
          : undefined,
        completion,
        model: providerID && modelID ? { providerID, modelID } : undefined,
        // Heartbeat: fires only when the judge is actually invoked, so a broken
        // judge (never firing) shows up as a stalled pipeline.
        onJudge: (r) => this.heartbeat?.record('consolidation', {
          ok: r.ok,
          error: r.error,
          counts: this.consolidationService?.getStats(),
        }),
        // B1: audit trail — one line per judge invocation (new, candidates,
        // cosines, verdict). The zero-update root cause gets decided from this
        // data (MinHash preemption vs judge bias vs cosine threshold).
        onPair: (pair) => {
          try {
            const logsDir = path.join(mafwDir, 'logs');
            fs.mkdirSync(logsDir, { recursive: true });
            fs.appendFileSync(path.join(logsDir, 'consolidation-pairs.jsonl'), JSON.stringify(pair) + '\n', 'utf-8');
          } catch { /* fail-open */ }
        },
        // V2 ①b L3: create-with-candidates observability — stamp a
        // dupCandidate anchor on the new entry's cue_anchors (top candidate
        // only, cap 1). graceRevisit's merge verdict is the executor.
        onCreate: (u, candidates) => {
          try {
            const entry = this.memoryService?.harmonicIndex?.getIndex()?.entries
              .find((e: any) => e.id === u.id) as any;
            if (!entry || entry.superseded_by) return;
            const anchor = `dupCandidate:${candidates[0]?.id ?? ''}`;
            if (!anchor.endsWith(':')) {
              const merged = [...new Set([...(entry.cue_anchors ?? []), anchor])].slice(0, 10);
              if (merged.length !== (entry.cue_anchors ?? []).length) {
                entry.cue_anchors = merged;
                this.memoryService!.harmonicIndex.save();
              }
            }
          } catch { /* fail-open */ }
        },
        // Persist stats across service rebuilds (initEmbeddingServices is
        // re-entrant on hot-swap) so updateRatio/skipped survive restarts.
        onStats: (s) => { try { this.getGatewayDb().kvSet('consolidation-stats', 'latest', s); } catch { /* fail-open */ } },
        initialStats: (() => { try { return this.getGatewayDb().kvGet('consolidation-stats', 'latest') ?? undefined; } catch { return undefined; } })(),
        minCosine: config.memory.embedding.minCosine,
        laya: layaDeps,
        budget: this.getPipelineBudget(),
      });
      log.info(
        `[Consolidation] enabled (judge: ${providerID || 'none'}; transport: ${
          direct ? 'direct HTTP' : 'runtime completion (resolved per call)'
        })`,
      );
    }
  }

  /** Spawn the laya conflict sidecar (windowsHide mandatory — detached
   *  gateway). Non-blocking readiness probe: cascade stays fail-open until
   *  healthy. HF_ENDPOINT routes the checkpoint download through hf-mirror
   *  (huggingface.co unreachable from this network). */
  private startLayaSidecar(python: string, script: string, cfg: { url: string; device?: string }): void {
    try {
      this.layaSidecar?.kill();
      const port = (() => { try { return new URL(cfg.url).port || '13129'; } catch { return '13129'; } })();
      this.layaSidecar = spawn(python, [script], {
        windowsHide: true,
        env: {
          ...process.env,
          LAYA_PORT: port,
          LAYA_DEVICE: cfg.device || 'cpu',
          HF_ENDPOINT: 'https://hf-mirror.com',
        },
      });
      this.layaSidecar.stdout?.on('data', (d) => log.info(`[Laya] ${String(d).trim()}`));
      this.layaSidecar.stderr?.on('data', (d) => log.warn(`[Laya] ${String(d).trim()}`));
      this.layaSidecar.on('exit', (code) => log.warn(`[Laya] sidecar exited (code=${code}) — cascade degraded to LLM-only (fail-open)`));
      const t0 = Date.now();
      (async () => {
        for (let i = 0; i < 30; i++) {
          try {
            const resp = await fetch(`${cfg.url}/health`, { signal: AbortSignal.timeout(1000) } as any);
            if (resp.ok) { log.info(`[Laya] sidecar ready (${((Date.now() - t0) / 1000).toFixed(1)}s)`); return; }
          } catch { /* not up yet */ }
          await new Promise((r) => setTimeout(r, 2000));
        }
        log.warn('[Laya] sidecar not healthy after 60s — cascade degraded (LLM-only)');
      })();
    } catch (err: any) {
      log.warn(`[Laya] sidecar spawn failed: ${err?.message || err}`);
    }
  }

  /** Shared core of POST /api/memory/embeddings/backfill. */
  private async backfillEmbeddings(limit?: number): Promise<any> {
    const rt = getEmbeddingRuntime();
    if (!rt) return null;
    const entries = this.memoryService?.harmonicIndex.getIndex().entries ?? [];
    let ids = entries.map(e => e.id);
    if (limit && limit > 0) ids = ids.slice(0, limit);
    const result = await rt.indexer.backfill(ids);
    return { ...result, vectors: rt.vectors.size(), indexEntries: entries.length };
  }

  /** Wave1Gateway 契约：POST /api/events 扁平未知类型遥测。 */
  recordUnknownEvent(type: string): void {
    try { this.unknownEventTracker.record('api', type); } catch { /* fail-open */ }
  }

  /** 注册 per-session 事件观察者（conformance harness 用）；返回注销函数。 */
  registerEventTap(sessionID: string, cb: (e: { type: string; sessionID?: string; at: number }) => void): () => void {
    let set = this.eventTaps.get(sessionID);
    if (!set) { set = new Set(); this.eventTaps.set(sessionID, set); }
    set.add(cb);
    return () => { set!.delete(cb); if (set!.size === 0) this.eventTaps.delete(sessionID); };
  }

  /** POST /api/runtime/conformance deps。 */
  private conformanceDeps(): ConformanceDeps {
    return {
      runtimeName: () => this.runtimeName,
      caps: () => this.runtimeCaps as any,
      createSession: async (opts) => this.runtime!.session.create({
        directory: opts?.directory ?? this.resolvedProjectDir(),
      }),
      promptAsync: async (opts) => { await this.runtime!.session.promptAsync(opts); },
      deleteSession: async (id) => { await this.runtime!.session.delete({ sessionID: id }); },
      listSessions: async () => {
        const r: any = await this.runtime!.session.list({});
        return Array.isArray(r) ? r : (r?.sessions || r?.data || []);
      },
      registerEventTap: (sid, cb) => this.registerEventTap(sid, cb),
      getObservations: (sessionID: string) => Promise.resolve(this.getGatewayDb().getObservationsBySession(sessionID)),
      getRecallCalledAt: (sessionID: string) => this.recallCalledBySession.get(sessionID) ?? null,
      bindIdentity: (sessionID: string, identity: string) => this.identityState.bind(sessionID, identity, 'session'),
      evaluatePolicy: (sessionID, candidate) => this.approvalPolicy.evaluate(sessionID, candidate),
      injectEvent: (evt) => this.handleRuntimeEvent(evt),
      getMessages: async (sessionID) => ((await this.runtime?.session.messages({ sessionID, limit: 5 })) as any)?.data ?? [],
      translationDrops: () => Object.fromEntries(this.translationDrops),
    };
  }

  /** POST /api/runtime/dry-event deps：插件事件映射声明（试衣间映射跳）。 */
  private dryEventDeps(): DryEventDeps {
    return {
      getPluginEventEntry: (name: string) => {
        const bridged = getBridgeEventEntry(name);
        if (bridged?.eventMappings?.length) return bridged;
        const e = this.runtimeLoader?.get(name);
        return e?.eventMappings?.length
          ? { eventSource: e.eventSource, eventMappings: e.eventMappings, transformEvent: e.transformEvent }
          : null;
      },
      hasPlugin: (name: string) => !!this.runtimeLoader?.has(name),
      listPlugins: () =>
        (this.runtimeLoader?.getState() ?? [])
          .filter((s) => s.status === 'ok' && s.name)
          .map((s) => s.name as string),
      isCanonicalType: (t: string) => CANONICAL_TYPE_SET.has(t),
    };
  }

  /**
   * 中性 terminal service：只持有 ticket/会话台账，runtime 每次现读（热切换安全）。
   * 原生 PTY 细节在 runtime adapter，此处不感知。
   */
  private getTerminalService(): TerminalService {
    if (!this.terminalService) {
      this.terminalService = new TerminalService({ getRuntime: () => this.runtime });
    }
    return this.terminalService;
  }

  /** P5 Wave 2：/api/runtime 路由 deps（自内联块上移，行为逐字节等价）。 */
  private runtimeDeps(): RuntimeSwitchDeps {
    return {
      loader: this.runtimeLoader,
      persist: (o: Record<string, any>) => config.persistOverrides(o),
      getCurrent: () => this.runtime,
      runtimeName: () => this.runtimeName,
      runtimeCaps: () => this.runtimeCaps,
      envOverride: () => !!process.env.MAFW_RUNTIME_PLUGIN,
      createRuntime: async () => {
        return this.createRuntime();
      },
      onSwitched: async (rt: RuntimeFacade, prev: RuntimeFacade | null) => {
        this.runtime = rt;
        this.setRuntimeDiagnostics();
        const previousName = this.runtimeNameBeforeSwitch;
        this.runtimeNameBeforeSwitch = null;
        // B2/B3：翻译守卫与拦截计数随 runtime 切换清空（per-runtime 快照语义）
        this.translationErrors.clear();
        this.translationDrops.clear();
        // Re-materialize identities on the freshly switched runtime (fire-and-forget).
        void this.materializeIdentities().catch(() => {});
        // Switching onto a runtime that owns serve (builtin opencode) must
        // ensure the sidecar exists — the gateway may have started under an
        // external runtime (pi) that never spawned one. Must run AFTER the
        // assignment above: the supervisor's spawn closure reads
        // this.runtimeHost to find agentProcess.spawnServe.
        if (this.runtimeHost?.agentProcess?.spawnServe) {
          await ensureServeForBuiltinRuntime(this.serveSupervisor, { startWatchdog: () => this.startServeWatchdog() }, log);
        }
        this.sdkSession.setClient(this.runtime);
        if (this.trajectoryCollector) this.trajectoryCollector.setRuntime(this.runtime);
        if (this.automationEngine) this.automationEngine.setRuntimeClient(rt);
        await this.resubscribeEvents(`runtime switched to '${this.runtimeName}'`);
        await this.reconcilePodLeads();
        // Desktop hint: a runtime switch swaps the session storage backend
        // (opencode SQLite vs pi), so cached session lists are stale.
        this.broadcast({ type: 'runtime_switched', runtime: this.runtimeName, previous: previousName });
        this.discovery?.invalidate();
        void this.discovery?.broadcastKnown('runtime_switched').catch((err: any) => log.warn(`[Discovery] runtime switch broadcast failed: ${err.message}`));
        if (prev && (prev as any).dispose) {
          try { await (prev as any).dispose(); }
          catch (err: any) { log.warn(`[Runtime] dispose old runtime failed: ${err.message}`); }
        }
      },
      unknownEvents: () => this.unknownEventTracker.snapshot(),
      validationNotes: () => this.runtimeValidationNotes,
      translationErrors: () => Object.fromEntries(this.translationErrors),
      translationDrops: () => Object.fromEntries(this.translationDrops),
      activeDialect: () => {
        const name = this.runtimeDiagnostics?.name ?? this.runtimeName;
        if (name.includes('@')) return name.split('@')[1]; // 钉死方言名（opencode@v2 → 'v2'）
        return this.runtimeDiagnostics?.activeDialect ?? null; // 自适应探测结果
      },
      contractCoverage: () => this.runtimeCoverage,
      contract: () => ({
        manifest: buildRuntimeContractManifest(),
        coverage: this.runtimeCoverage,
      }),
    };
  }

  /** P5 Wave 2：/api/runtime/restart-agent deps（surface 门 process.restart）。 */
  private restartAgentDeps(): RestartAgentDeps {
    return {
      getAccess: () => this.runtime?.access ?? null,
      isRecovering: () => this.serveRecovering,
      isSwitching: () => this.switchingRuntime,
      begin: () => { this.serveRecovering = true; },
      end: () => { this.serveRecovering = false; },
      restartAgent: () => this.restartAgentOrchestrated(),
    };
  }

  /**
   * 统一插件包的客户端快照（序列化 DTO only）。
   * 正式 REST 出口由 Task 6 的 `/api/plugins/client` 复用；这里只保存最近一次 commit。
   */
  getPluginClientSnapshot(): PluginClientSnapshot {
    return this.pluginClientSnapshot ?? this.pluginHost?.getClientSnapshot() ?? { revision: '0:0', plugins: [] };
  }

  /** 统一插件包文件系统操作入口（Task 6 REST 路由复用）。 */
  getPackageManager(): PackageManager | undefined {
    return this.packageManager;
  }

  /** Task 6：/api/plugins/client + manager/action 路由 deps。 */
  private pluginPackagesDeps(): PluginPackagesRouteDeps {
    const host = this.pluginHost;
    return {
      manager: () => this.packageManager,
      snapshot: () => this.getPluginClientSnapshot(),
      // Before host init no package can be known: omit the invoker so the
      // action route answers the registry's neutral 404 instead of a 500.
      ...(host
        ? { invokeAction: (name, action, input, options) => host.invokeAction(name, action, input, options) }
        : {}),
      // Applying a runtime package commits the files, but the live runtime is
      // still the old instance. Reuse the exact `/api/runtime/switch` sequence
      // (same guard/mutex, event resubscription, identity rematerialization and
      // fallback detection) instead of a second hand-rolled copy.
      switchRuntime: (name: string) =>
        performRuntimeSwitch(this.runtimeDeps(), name, {
          blocked: () => this.serveRecovering || this.switchingRuntime,
          begin: () => { this.switchingRuntime = true; },
          end: () => { this.switchingRuntime = false; },
        }),
    };
  }

  /**
   * Task 4：Plugin Web surface deps。所有查询都是 thunk——宿主/manager 未初始化时
   * 也要能构造 deps（route 直接 404）。
   */
  private pluginWebDeps(): PluginWebRouteDeps {
    return {
      isActivePackage: (name) => this.pluginHost?.isPackageCommitted(name) ?? false,
      packageDir: (name) => this.pluginHost?.getCommittedPackageDir(name) ?? null,
      listProjects: () => Array.from(this.registeredProjects.keys()),
      // Parallel-worktree sessions bind their surface to the worktree directory
      // (it is a sibling of the project, so containment alone cannot accept it).
      listWorktreeDirs: () => {
        try {
          return this.getGatewayDb()
            .kvAll<{ dir?: unknown }>('session-worktree')
            .map((entry) => (typeof entry.value?.dir === 'string' ? entry.value.dir : null))
            .filter((dir): dir is string => typeof dir === 'string' && dir.length > 0);
        } catch {
          return [];
        }
      },
      tickets: this.pluginWebTickets,
      httpRegistry: () => this.pluginHost?.getHttpRegistry(),
      isLoopback: (req) => isLoopbackAddr(req.socket?.remoteAddress || ''),
      defaultProjectDir: () => this.resolvedProjectDir(),
      // 复用 gateway 唯一的 broadcast 通道：把过滤 writer 注册成普通 SSE 客户端，
      // broadcast() 照常写帧，writer 只放行 plugin:<pkg>:* 并自行写响应。
      attachEventStream: (res, write) => {
        this.sseClients.set(res, write);
        return () => { this.sseClients.delete(res); };
      },
    };
  }

  /**
   * 通配的 Plugin Web 路径（registry 只支持精确段数）：
   * `GET /api/plugins/<pkg>/ui/*` 与 `/api/plugins/<pkg>/api/*`。
   *
   * @returns true = 已由这里处理（含 404），false = 与插件 Web 无关。
   */
  private async handlePluginWebWildcard(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<boolean> {
    // Cheap gate: only the package namespace can match below.
    if (!req.url || !req.url.startsWith('/api/plugins/')) return false;

    const asset = parsePluginWebAssetUrl(req.url);
    if (asset && req.method === 'GET') {
      await handlePluginWebAsset(req, res, this.pluginWebDeps(), { name: asset.name });
      return true;
    }
    const api = parsePluginApiUrl(req.url);
    if (api) {
      await handlePluginApiRoute(req, res, this.pluginWebDeps(), api.name, api.path);
      return true;
    }
    return false;
  }

  /**
   * GET /api/plugins 的统一包清单：宿主状态 + manager 持久化的禁用名。
   *
   * 宿主在扫描时跳过禁用包，所以 `getState()` 里没有它们；Hub 必须从状态存储
   * 合并回来，否则用户无法在管理界面重新启用。
   */
  private pluginPackageInventory(): PluginsPackageEntry[] {
    return mergePackageInventory(
      this.pluginHost?.getState() ?? [],
      this.packageStateStore?.read().disabled ?? [],
    );
  }

  /** P5 Wave 2：/api/plugins* deps（Plugin Hub 四类型统一面）。 */
  private pluginHubDeps(): PluginsRouteDeps {
    return {
      hub: {
        dirs: {
          runtime: config.resolvePath('runtime-plugins'),
          media: config.resolvePath('media-plugins'),
          usage: config.resolvePath('usage-plugins'),
          ui: process.env.MAFW_UI_PLUGINS_DIR || path.join(os.homedir(), '.mafw', 'ui-plugins'),
        },
        builtinEntries: (): any[] => {
          const entries: any[] = [];
          const rt = (name: string) => ({ type: 'runtime', name, file: '(builtin)', status: 'enabled', size: 0, mtime: '' });
          for (const name of this.runtimeLoader?.getBuiltinNames?.() ?? []) entries.push(rt(name));
          for (const name of this.mediaPluginLoader?.getBuiltinEngineNames?.() ?? []) {
            entries.push({ type: 'media', name, file: '(builtin)', status: 'enabled', size: 0, mtime: '' });
          }
          const usageState: any[] = this.pluginLoader?.getState?.() ?? [];
          for (const s of usageState) {
            if (s.builtin && s.status === 'ok' && s.name) {
              entries.push({ type: 'usage', name: s.name, file: s.file, status: 'enabled', size: 0, mtime: '', pluginType: s.pluginType });
            }
          }
          return entries;
        },
        getErrors: (type: string): Record<string, string> => {
          const stateOf = (loader: any): any[] => (loader && typeof loader.getState === 'function' ? loader.getState() : []);
          const source = type === 'runtime' ? this.runtimeLoader : type === 'media' ? this.mediaPluginLoader : type === 'usage' ? this.pluginLoader : null;
          const out: Record<string, string> = {};
          for (const p of stateOf(source)) {
            if (p && p.error) out[p.name || p.file] = p.error;
          }
          return out;
        },
        configDisabledUsage: () => new Set<string>(Array.isArray(config.usage?.disabledPlugins) ? config.usage.disabledPlugins : []),
        reload: async (type: string): Promise<void> => {
          if (type === 'runtime') await this.runtimeLoader?.scan();
          else if (type === 'media') await this.mediaPluginLoader?.reload();
          else if (type === 'usage') await this.pluginLoader?.reload();
          // ui: desktop main fs.watch picks it up automatically
        },
      } as any,
      packages: () => this.pluginPackageInventory(),
      packageRevision: () => this.getPluginClientSnapshot().revision,
      getManager: () => this.packageManager,
    };
  }

  private embeddingConfigDeps(): EmbeddingConfigDeps {    return {
      currentConfig: () => {
        const e = config.raw.memory.embedding;
        return {
          provider: e.provider,
          engine: e.engine ?? 'onnx',
          model: e.model,
          dimensions: e.dimensions,
          threads: e.threads,
          llamacpp: {
            gpu: e.llamacpp?.gpu ?? 'cpu',
            threads: e.llamacpp?.threads ?? e.threads,
            contextSize: e.llamacpp?.contextSize ?? 2048,
            batchSize: e.llamacpp?.batchSize ?? 256,
          },
        };
      },
      persist: (o) => config.persistOverrides(o),
      reinit: () => {
        this.initEmbeddingServices(config.resolvePath());
        return { active: getEmbeddingRuntime()?.provider.name ?? null };
      },
      runtimeState: () => {
        const rt = getEmbeddingRuntime();
        const indexEntries = this.memoryService?.harmonicIndex.getIndex().entries.length ?? 0;
        const vectors = rt?.vectors.size() ?? 0;
        return {
          active: rt?.provider.name ?? null,
          vectors,
          indexEntries,
          coverage: indexEntries > 0 ? vectors / indexEntries : 1,
        };
      },
      scheduleBackfill: () => {
        this.backfillEmbeddings().catch((err: any) =>
          log.warn(`[Embedding] post-switch backfill failed: ${err?.message || err}`));
      },
    };
  }

  private modelConfigDeps(): ModelConfigDeps {
    return {
      persist: (o) => config.persistOverrides(o),
      listProviders: async () => {
        if (!this.runtime) return null;
        const result: any = await this.runtime.provider.list();
        const all = result?.all;
        if (!Array.isArray(all)) return null;
        return all.map((p: any) => ({
          providerID: p.id,
          providerName: p.name ?? p.id,
          models: Object.entries(p.models ?? {}).map(([id, m]: [string, any]) => ({ id, name: m?.name ?? id })),
        }));
      },
      currentConfig: () => ({
        recall: { workerModel: config.raw.recall.workerModel },
        media: {
          provider: config.raw.media.provider,
          model: config.raw.media.model,
          image: config.raw.media.image,
          video: config.raw.media.video,
          audio: config.raw.media.audio,
        },
        goal: {
          nodeModel: config.raw.goal?.nodeModel ?? null,
          techLeadModel: config.raw.goal?.techLeadModel ?? null,
        },
      }),
      invalidateScanService: () => { this.scanService = null; },
    };
  }

  private usagePluginsDeps(): UsagePluginsDeps {
    const builtinDir = path.join(__dirname, 'usage', 'builtin-plugins');
    const readBuiltinSource = (name: string): string | null => {
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) return null;
      try { return fs.readFileSync(path.join(builtinDir, name + '.js'), 'utf8'); } catch { return null; }
    };
    return {
      loader: this.pluginLoader!,
      pluginsDir: path.join(os.homedir(), '.mafw', 'usage-plugins'),
      getDisabled: () => (Array.isArray(config.usage?.disabledPlugins) ? config.usage.disabledPlugins : []),
      getPluginConfig: (name) => config.usage?.pluginConfig?.[name] ?? null,
      readBuiltinSource,
      runAdapter: async (name) => {
        const adapter = this.pluginLoader?.getAdapters().find(a => a.name === name);
        if (!adapter) return { ok: false, error: 'plugin not found or disabled' };
        try { return { ok: true, result: await adapter.fetch() }; } catch (err: any) { return { ok: false, error: err.message }; }
      },
      builtinNames: () => {
        try { return fs.readdirSync(builtinDir).filter(f => f.endsWith('.js')).map(f => f.replace(/\.js$/, '')); } catch { return []; }
      },
    };
  }

  // ---- R8 predictive prefetch snapshot ----
  /** Per-session debounce timers for the background snapshot refresh. */
  private snapshotTimers = new Map<string, NodeJS.Timeout>();
  /** 激活期 runtime 校验记录（能力降级 + 警告），GET /api/runtime 暴露。 */
  private runtimeValidationNotes: string[] = [];
  /** 激活期覆盖矩阵（清单驱动），GET /api/runtime(.contract) 暴露。 */
  private runtimeCoverage: RuntimeCoverage | null = null;
  /** Schedule a debounced snapshot refresh (called on each user turn). */
  private scheduleSnapshotRefresh(sessionID: string): void {
    const cfg = config.search.snapshot;
    if (!cfg?.enabled || !this.memoryService || !sessionID) return;
    const existing = this.snapshotTimers.get(sessionID);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.snapshotTimers.delete(sessionID);
      this.refreshSnapshot(sessionID).catch(() => { /* fail-open */ });
    }, cfg.debounceMs ?? 2000);
    (timer as any).unref?.();
    this.snapshotTimers.set(sessionID, timer);
  }

  /**
   * Build the expensive retrieval for a session in the background: BM25 +
   * expansion (+ optional reranker) rendered as the pointer block, stored in kv
   * so the boundary path can serve it inside the 100ms contract.
   *
   * Submitted to the unified scheduler as midground + defer-to-idle: one build
   * at a time per key (concurrent requests queue, not drop), and queued builds
   * wait for foreground quiescence before starting.
   */
  private async refreshSnapshot(sessionID: string): Promise<void> {
    if (!this.memoryService) return;
    await this.scheduler.submit(
      { id: `snapshot:${sessionID}`, priority: 'midground', mutexKey: 'snapshot', strategy: 'defer-to-idle' },
      () => this.refreshSnapshotInner(sessionID),
    );
  }

  private async refreshSnapshotInner(sessionID: string): Promise<void> {
    if (!this.memoryService) return;
    const db = this.getGatewayDb();
    const { buildSnapshot } = require('./recall/snapshot-builder');
    const { searchRecallMemoriesSync, recallNeighbors } = require('./recall/recall-context');
    const { formatRecallContext } = require('./recall/inject-format');
    const { getReranker } = require('./core/memory/reranker-singleton');
    const { applyReranker } = require('./core/memory/reranker');
    const t0 = Date.now();
    const snap = await buildSnapshot({
      recentTurnTexts: (sid: string, maxTurns: number) => {
        const out: string[] = [];
        for (const turn of db.listTurns(sid).slice(-maxTurns)) {
          for (const obs of db.readTurn(sid, turn.turn_id)) {
            if (obs.source === 'user_input' || obs.source === 'assistant_reply') out.push(obs.content);
          }
        }
        return out;
      },
      // R2+R3 wiring for the boundary path: build the snapshot with the dense
      // channel (query embedding ~8ms, background so it is affordable) fused
      // with BM25, then the R3 rerank — the best-measured combination. Falls
      // back to BM25 when no embedding provider is configured/available.
      search: async (q: string, n: number) => {
        const { searchRecallMemories } = require('./recall/recall-context');
        let denseScores: Map<string, number> | undefined;
        if ((config.search.snapshot.retriever ?? 'hybrid') === 'hybrid') {
          try {
            const { computeDenseScores } = require('./memory/embedding-runtime');
            denseScores = (await computeDenseScores(q, n * 4, this.memoryService!.harmonicIndex)) ?? undefined;
          } catch { /* fail-open: BM25 only */ }
        }
        return searchRecallMemories(this.memoryService!.harmonicIndex, q, new Set<string>(), n, {
          retriever: 'bm25',
          denseScores,
          scanSnapshot: this.getScanService()?.getSnapshot(sessionID) ?? null,
        } as any);
      },
      // V1 verbatim layer: dense t1 round hits fused into the snapshot block.
      ...(config.recall.t1Recall?.enabled !== false
        ? (() => {
            const { getEmbeddingRuntime: getRt } = require('./memory/embedding-runtime');
            const { makeT1Search } = require('./recall/verbatim-recall');
            const rt = getRt();
            if (!rt?.t1Vectors) return {};
            return {
              searchT1: makeT1Search({
                runtime: rt,
                fetchRows: (sid: string, tid: number) => {
                  const rows = db.readArchiveTurn(sid, tid);
                  return rows.length ? rows : db.readTurn(sid, tid);
                },
              }),
            };
          })()
        : {}),
      rerank: async (q: string, ms: any[]) => {
        const reranker = getReranker();
        if (!reranker) return ms;
        const byId = new Map(ms.map((m: any) => [m.id, m]));
        const scored = await applyReranker(
          q,
          ms.map((m: any) => ({
            entry: { id: m.id, primary_abstraction: m.primary_abstraction, cue_anchors: [], created_at: m.created_at } as any,
            score: m.score,
          })),
          reranker,
          ms.length,
          0,
        );
        return scored.map((s: any) => byId.get(s.entry.id)).filter(Boolean) as any[];
      },
      render: (ms: any[], status?: any) => {
        const tn = config.search.temporalNeighbors;
        const neighbors = tn?.presentation
          ? recallNeighbors(this.memoryService!.harmonicIndex, ms, tn)
          : undefined;
        return formatRecallContext(ms, {
          status: status ?? 'inject',
          neighbors: neighbors && neighbors.size > 0 ? neighbors : undefined,
        }).pointers;
      },
      // R3 + R5 in ONE reranker pass: the same scoring call yields both the
      // reranked order and the top-1 relevance probability used by the FOK gate
      // (two separate calls doubled the GPU cost and starved the boundary path).
      verify: config.search.fok?.enabled || config.search.reranker !== 'off'
        ? async (q: string, ms: any[]) => {
            const r: any = getReranker();
            if (!r || ms.length === 0) return { memories: ms };
            const byId = new Map(ms.map((m: any) => [m.id, m]));
            const toScored = (m: any) => ({
              entry: { id: m.id, primary_abstraction: m.primary_abstraction, cue_anchors: [], created_at: m.created_at } as any,
              score: m.score,
            });
            if (typeof r.rerankDetailed === 'function') {
              const detailed = await r.rerankDetailed(q, ms.map(toScored), ms.length);
              if (!detailed) return { memories: ms };
              const reranked = detailed.scored.map((s: any) => byId.get(s.entry.id)).filter(Boolean);
              const topId = detailed.scored[0]?.entry?.id;
              const topProb = topId ? detailed.probs[ms.findIndex((m: any) => m.id === topId)] : undefined;
              let zone: any;
              if (config.search.fok?.enabled && topProb !== undefined) {
                const { zoneFromProbability } = require('./recall/fok-gate');
                zone = zoneFromProbability(topProb, config.search.fok.probLow, config.search.fok.probHigh);
                log.info(`[Recall] FOK zone=${zone} (top1prob=${topProb.toFixed(3)}) for snapshot`);
              }
              return { memories: reranked.length ? reranked : ms, fokStatus: zone, top1prob: topProb };
            }
            // Fallback: rerank without probabilities (no FOK zone).
            const { applyReranker } = require('./core/memory/reranker');
            const scored = await applyReranker(q, ms.map(toScored), r, ms.length, 0);
            const reranked = scored.map((s: any) => byId.get(s.entry.id)).filter(Boolean);
            return { memories: reranked.length ? reranked : ms };
          }
        : undefined,
      store: (sid: string, s: any) => db.kvSet('recall-snapshot', sid, s),
    }, sessionID, config.search.snapshot, 3);
    if (snap) log.info(`[Recall] snapshot built for ${sessionID} (${Date.now() - t0}ms, ${snap.ids.length} ids)`);
    // L3: FOK calibration sample — record the injection with the top-1
    // memory's topic (its first cue anchor) so per-topic thresholds can be fit.
    if (snap && typeof snap.top1prob === 'number') {
      try {
        const { appendFokEvent } = require('./recall/fok-samples');
        const topId = snap.ids?.[0];
        const entry = topId
          ? this.memoryService?.harmonicIndex.getIndex().entries.find((e: any) => e.id === topId)
          : undefined;
        appendFokEvent({
          e: 'inj', ts: Date.now(), top1prob: snap.top1prob,
          zone: snap.fokStatus ?? 'inject', ids: snap.ids ?? [],
          topic: entry?.cue_anchors?.[0],
        });
      } catch { /* fail-open */ }
    }
  }

  private getScanService(): IndexScanService | null {
    if (!this.memoryService) return null;
    if (!this.scanService) {
      // Scan is a stateless classification call — direct OpenAI-compatible
      // HTTP to the worker model (no opencode session churn). Credentials
      // resolve via runtime credentials → opencode auth.json fallback.
      this.scanService = new IndexScanService(
        this.memoryService.harmonicIndex,
        config.recall.workerModel,
        {
          credentials: this.runtimeHost?.credentials
            ? { getApiKey: (p) => this.runtimeHost!.credentials!.getApiKey(p) }
            : undefined,
          baseUrl: (config.recall as any).scanApiUrl || undefined,
          scanEndpoints: (config.recall as any).scanEndpoints || undefined,
          timeoutMs: config.recall.scanTimeoutMs,
          maxIndexChars: config.recall.scanMaxIndexChars,
          budget: this.getPipelineBudget(),
          // Runtime 契约的无状态补全通道（thunk 现读，热切换安全）——
          // 提供时 scan 优先走 completion.complete，直连 HTTP 降为回退。
          completion: () => this.runtimeCompletionChannel(),
          // Any openai-compatible provider works out of the box: URL and key
          // come from the opencode provider config (inline-defined providers
          // like "gateway" keep their credentials in opencode.jsonc options).
          resolveEndpoint: async (providerID) => {
            try {
              const cfg: any = await this.runtimeHost?.config.get();
              const u = readProviderBaseUrlWithPath(cfg, providerID);
              if (u) return u;
            } catch { /* fail-open to the next resolution step */ }
            try {
              const list: any = await this.runtime?.provider?.list?.();
              return readProviderTransportFromList(list, providerID).baseUrl;
            } catch { /* fail-open */ }
            return null;
          },
          resolveApiKey: async (providerID) => {
            try {
              const viaCreds = this.runtimeHost?.credentials?.getApiKey(providerID);
              if (viaCreds) return viaCreds;
              const cfg: any = await this.runtimeHost?.config.get();
              const k = readProviderApiKey(cfg, providerID);
              if (k) return k;
            } catch { /* fail-open to the next resolution step */ }
            try {
              const list: any = await this.runtime?.provider?.list?.();
              return readProviderTransportFromList(list, providerID).apiKey;
            } catch { /* fail-open */ }
            return null;
          },
          recordUsage: (u) => {
            try {
              const store = this.trajectoryStore;
              if (!store) return;
              const now = Date.now();
              store.upsertTurn({
                projectID: this.projectDir,
                sessionID: 'index-scan-direct',
                turnID: now,
                turnStartMs: now - u.latencyMs,
                turnEndMs: now,
                durationMs: u.latencyMs,
                toolCount: 0,
                toolErrorCount: 0,
                reasoningCount: 0,
                agentSwitchCount: 0,
                tokens: { input: u.input, output: u.output, reasoning: 0, cache: { read: u.cached, write: 0 } },
                cost: 0,
                finish: u.ok ? 'stop' : 'error',
                model: u.modelID ?? null,
                provider: u.providerID ?? null,
                agent: null,
                userText: '',
                workerRole: 'index-scan',
              });
            } catch { /* never block the scan path */ }
          },
        },
      );
      // Initial cache population
      this.scanService.refreshCache();
    }
    return this.scanService;
  }

  /** Goal 会话预算挂载：读 state/<goalId>.json 的 policySnapshot.{maxTurns,maxCostUsd}；
   *  两者都缺或 runtime 原生支持 turnBudgetApi 时不挂。 */
  private attachBudgetGuardForGoal(goalId: string, sessionID: string, mafwDir: string): void {
    try {
      if (!this.runtime || this.runtimeCaps.turnBudgetApi) return;
      const statePath = path.join(mafwDir, 'state', `${goalId}.json`);
      if (!fs.existsSync(statePath)) return;
      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      const maxTurns = state?.policySnapshot?.maxTurns;
      const maxCostUsd = state?.policySnapshot?.maxCostUsd;
      if (typeof maxTurns !== 'number' && typeof maxCostUsd !== 'number') return;
      this.budgetGuards.set(sessionID, new BudgetGuard({
        sessionID,
        maxTurns,
        maxCostUsd,
        getCostUsd: (sid) => this.trajectoryStore?.getSessionTokenSummary(sid).totalCost ?? 0,
        abort: (sid) => this.runtime!.session.abort({ sessionID: sid }),
        notify: async (sid, text) => {
          // G6 迁移：预算硬停通知走队列交付 + 幂等键（同会话不双发）
          await this.runtime!.session.promptAsync({ sessionID: sid, parts: [{ type: 'text', text }], expectReply: false, delivery: 'queue', idempotencyKey: `budget-stop-${sid}` });
        },
        log: (msg) => log.info(msg),
      }));
      log.info(`[BudgetGuard] attached for goal ${goalId} session=${sessionID} (maxTurns=${maxTurns ?? '-'} maxCostUsd=${maxCostUsd ?? '-'})`);
    } catch (err: any) {
      log.warn(`[BudgetGuard] attach failed for ${sessionID} (non-fatal): ${err.message}`);
    }
  }

  /** Per-prompt 预算挂载（P0-2，2026-10-22）：普通会话经 HTTP promptAsync body
   *  传入 maxTurns/maxCostUsd 的兜底路径。裁决走 resolvePromptBudget（纯函数）：
   *  goal guard 优先不顶掉；上次 per-prompt 预算不泄漏（replace）。回合终态
   *  （turn.completed/failed/aborted）由 handleOpencodeEvent 清理。 */
  private attachBudgetGuardForPrompt(sessionID: string, maxTurns?: number, maxCostUsd?: number): void {
    try {
      if (!this.runtime || this.runtimeCaps.turnBudgetApi) return;
      const existing: PromptBudgetExisting = this.promptBudgetSessions.has(sessionID)
        ? 'prompt'
        : this.budgetGuards.has(sessionID) ? 'goal' : 'none';
      const decision = resolvePromptBudget(existing, maxTurns, maxCostUsd);
      if (decision === 'skip-empty' || decision === 'skip-goal') return;
      this.budgetGuards.set(sessionID, new BudgetGuard({
        sessionID,
        maxTurns,
        maxCostUsd,
        getCostUsd: (sid) => this.trajectoryStore?.getSessionTokenSummary(sid).totalCost ?? 0,
        abort: (sid) => this.runtime!.session.abort({ sessionID: sid }),
        notify: async (sid, text) => {
          // G6 迁移：预算硬停通知走队列交付 + 幂等键（同会话不双发）
          await this.runtime!.session.promptAsync({ sessionID: sid, parts: [{ type: 'text', text }], expectReply: false, delivery: 'queue', idempotencyKey: `budget-stop-${sid}` });
        },
        log: (msg) => log.info(msg),
      }));
      this.promptBudgetSessions.add(sessionID);
      log.info(`[BudgetGuard] attached for prompt session=${sessionID} (maxTurns=${maxTurns ?? '-'} maxCostUsd=${maxCostUsd ?? '-'})`);
    } catch (err: any) {
      log.warn(`[BudgetGuard] prompt attach failed for ${sessionID} (non-fatal): ${err.message}`);
    }
  }

  /** 队列防楔死清扫（spec §5.1 v2 Q2，60s 周期）：
   *  busy 超 BUSY_STALE_MS 清除（假 busy——如 noReply prompt 触发 prompted-无回合——
   *  最坏损害限制为 15 分钟排队延迟）+ 队列项超 QUEUE_ITEM_TTL_MS 摘除（孤儿消息不无限堆积）。
   *  事件发射（queue.updated expire）与 flush 续发在 Task 4/5 接线。 */
  private sweepBusyAndQueue(): void {
    try {
      const now = Date.now();
      for (const [sid, startedAt] of [...this.busySessions]) {
        if (now - startedAt >= BUSY_STALE_MS) {
          this.busySessions.delete(sid);
          log.warn(`[Queue] busy state stale-cleared for ${sid} (>= ${BUSY_STALE_MS}ms without terminal)`);
          this.flushSessionQueue(sid);  // 防楔死恢复后续发
        }
      }
      // 队列项 TTL：逐会话摘除（只扫有队的会话）
      for (const sid of this.sessionQueue.sessions()) {
        const expired = this.sessionQueue.expireOlderThan(sid, QUEUE_ITEM_TTL_MS);
        for (const item of expired) {
          log.warn(`[Queue] item ${item.id} expired (TTL ${QUEUE_ITEM_TTL_MS}ms) in ${sid}`);
          this.emitQueueUpdated(sid, 'expire', this.sessionQueue.list(sid), item.id);
        }
      }
    } catch (err: any) {
      log.warn(`[Queue] sweep failed (non-fatal): ${err.message}`);
    }
  }

  private registerMemoryPipelineActions(): void {
    const engine = this.automationEngine;
    if (!engine) return;
    // Actions are registered through a provider so refreshActions() — called
    // by engine.start() and reloadRules() — rebuilds the registry
    // deterministically instead of relying on registration order (spec §5.4).
    // Budget taskOpts use the pipelines' own internal PipelineBudget.allow()
    // names so admission and per-call checks share one name (one deny log/day).
    engine.setActionsProvider(() => {
      engine.registerAction('memory:turnCompress', async () => {
        try {
          const pipeline = this.getTurnPipeline();
          const res = await pipeline.runOnce();
          log.info(
            `[TurnPipeline] sessions=${res.sessions} turns=${res.turns} archived=${res.archived} noops=${res.noops} replayed=${res.replayed} failed=${res.failed}`,
          );
          this.heartbeat?.record('memory:turnCompress', {
            ok: res.failed === 0,
            error: res.failed > 0 ? `${res.failed} session(s) failed` : undefined,
            counts: { sessions: res.sessions, turns: res.turns, archived: res.archived, replayed: res.replayed, failed: res.failed },
          });
          // Refresh index scan cache after compression (new memories may have been written)
          this.scanService?.refreshCache();
        } catch (err: any) {
          this.heartbeat?.record('memory:turnCompress', { ok: false, error: err.message });
          log.warn(`[TurnPipeline] run failed: ${err.message}`);
        }
      }, { budget: { kind: 'pipeline', pipeline: 'extract' } });
      engine.registerAction('memory:reflect', async () => {
        try {
          const pipeline = this.getReflectPipeline();
          const res = await pipeline.runAll();
          log.info(
            `[Reflection] sessions=${res.sessions} reviewed=${res.reviewed} distilled=${res.distilled} deduped=${res.deduped} superseded=${res.superseded} failed=${res.failed}`,
          );
          this.heartbeat?.record('memory:reflect', {
            ok: res.failed === 0,
            error: res.failed > 0 ? `${res.failed} session(s) failed` : undefined,
            counts: { sessions: res.sessions, reviewed: res.reviewed, distilled: res.distilled, superseded: res.superseded, failed: res.failed },
          });
        } catch (err: any) {
          this.heartbeat?.record('memory:reflect', { ok: false, error: err.message });
          log.warn(`[Reflection] run failed: ${err.message}`);
        }
        // V2 ④: grace-period re-visit phase — same cron, budget-gated, PE-
        // gated candidate selection; shadow mode (default) logs verdicts
        // only, live executes (user-authority entries stay observe-only).
        try {
          if (!this.memoryService) return;
          const mode = config.recall?.graceRevisit ?? 'shadow';
          if (mode === 'off') return;
          const { GraceRevisitPipeline, createGraceWriteOps } = require('./recall/grace-revisit');
          const store = new HarmonicUnitFileStore(config.resolvePath(), this.memoryService.harmonicIndex);
          const logsDir = path.join(config.resolvePath(), 'logs');
          const grace = new GraceRevisitPipeline({
            index: this.memoryService.harmonicIndex,
            readMemory: (id: string) => store.read(id),
            worker: {
              prompt: (t: string, s: string) =>
                this.getPool().getWorker('grace', 'reflect').prompt(t, s, config.recall.workerModel, 'memory-curator'),
            },
            ...createGraceWriteOps(store),
            mode: mode === 'live' ? 'live' : 'shadow',
            onVerdict: (v: any) => {
              try {
                fs.mkdirSync(logsDir, { recursive: true });
                fs.appendFileSync(path.join(logsDir, 'grace-verdicts.jsonl'), JSON.stringify({ ...v, ts: Date.now() }) + '\n', 'utf-8');
              } catch { /* fail-open */ }
            },
            // V2 ⑥: salience-v2 observe — components to jsonl, never written
            // back to entries or ranking.
            onSalience: (l: any) => {
              try {
                fs.mkdirSync(logsDir, { recursive: true });
                fs.appendFileSync(path.join(logsDir, 'salience-v2.jsonl'), JSON.stringify(l) + '\n', 'utf-8');
              } catch { /* fail-open */ }
            },
            needFor: (() => {
              try {
                const { getRetrievalEventBuffer } = require('./core/memory/retrieval-events');
                const buf = getRetrievalEventBuffer();
                return (id: string) => buf.needFor(id);
              } catch { return undefined; }
            })(),
            budget: this.getPipelineBudget(),
          });
          const r = await grace.runOnce();
          if (r.selected > 0) {
            log.info(`[GraceRevisit] mode=${mode} selected=${r.selected} kept=${r.kept} updated=${r.updated} merged=${r.merged} demoted=${r.demoted} skipped=${r.skipped}`);
          }
          this.heartbeat?.record('memory:graceRevisit', { ok: true, counts: { ...r, mode } });
        } catch (err: any) {
          this.heartbeat?.record('memory:graceRevisit', { ok: false, error: err.message });
          log.warn(`[GraceRevisit] phase failed: ${err.message}`);
        }
      }, { budget: { kind: 'pipeline', pipeline: 'reflect' } });
    // memory:review — the builtin stub only logged the dormant review queue;
    // this registration replaces it: the curator worker re-checks high-value
    // procedural/semantic memories against the live environment with read-only
    // tools and supersedes contradicted ones (environment-probing curation,
    // arXiv:2609.11060).
    engine.registerAction('memory:review', async () => {
        try {
          const pipeline = this.getStaleVerifyPipeline();
          const res = await pipeline.runOnce();
          log.info(
            `[StaleVerify] candidates=${res.candidates} checked=${res.checked} superseded=${res.superseded} failed=${res.failed}`,
          );
          // A1: persist review scheduling stamps (review_count/last_reviewed).
          try {
            this.memoryService?.harmonicIndex?.save?.();
          } catch { /* fail-open */ }
          this.heartbeat?.record('memory:review', {
            ok: !res.failed,
            error: res.failed ? 'stale-verify worker failed' : undefined,
            counts: { candidates: res.candidates, checked: res.checked, superseded: res.superseded },
          });
        } catch (err: any) {
          this.heartbeat?.record('memory:review', { ok: false, error: err.message });
          log.warn(`[StaleVerify] run failed: ${err.message}`);
        }
      }, { budget: { kind: 'pipeline', pipeline: 'review' } });
    // D2: reconsolidation sweep — mutated (labile) memories are checked daily
    // against newer related memories; contradicted ones are updated through the
    // supersedes chain (budget-gated, fail-open).
    engine.registerAction('memory:reconsolidate', async () => {
        try {
          if (!this.memoryService) return;
          const { ReconsolidatePipeline } = require('./recall/reconsolidate-pipeline');
          const { getReconsolidationQueue } = require('./recall/reconsolidation');
          const store = new HarmonicUnitFileStore(config.resolvePath(), this.memoryService.harmonicIndex);
          const pipeline = new ReconsolidatePipeline({
            queue: getReconsolidationQueue(),
            index: this.memoryService.harmonicIndex,
            readMemory: (id: string) => store.read(id),
            readRelated: (id: string) => store.read(id),
            worker: {
              prompt: (t: string, s: string) =>
                this.getPool().getWorker('reconsolidate', 'reflect').prompt(t, s, config.recall.workerModel, 'memory-curator'),
            },
            writeSuperseding: async (oldId: string, content: string) => {
              const { generateHarmonicId } = require('./core/memory/harmonic-types');
              const old = await store.read(oldId);
              const id = generateHarmonicId();
              await store.write({
                id,
                type: old?.type ?? 'semantic',
                primary_abstraction: content.slice(0, 80),
                cue_anchors: [...((old?.cue_anchors ?? []).filter((c: string) => c !== 'reconsolidate')), 'reconsolidated'],
                memory_value: content,
                energy: Math.max(0.8, old?.energy ?? 0.8),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              } as any);
              await store.markSuperseded(oldId, id);
              return id;
            },
            budget: this.getPipelineBudget(),
          });
          const r = await pipeline.runOnce();
          if (r.checked > 0) {
            log.info(`[Reconsolidate] checked=${r.checked} rewritten=${r.rewritten} skipped=${r.skipped}`);
          }
          this.heartbeat?.record('memory:reconsolidate', { ok: true, counts: r });
        } catch (err: any) {
          this.heartbeat?.record('memory:reconsolidate', { ok: false, error: err.message });
          log.warn(`[Reconsolidate] run failed: ${err.message}`);
        }
      }, { budget: { kind: 'pipeline', pipeline: 'reconsolidate' } });
    // D4a: nightly dream prefetch — generate likely next-session queries for
    // recently-active sessions; the first user input of the day consumes them.
    engine.registerAction('memory:dream', async () => {
        try {
          if (!this.scanService) return;
          const { selectDreamSessions, parseDreamQueries, DREAM_SYSTEM } = require('./recall/dream-prefetch');
          const db = this.getGatewayDb();
          const sids = selectDreamSessions(db.listTurns(), {
            now: Date.now(), maxSessions: 5, windowMs: 24 * 3600_000,
            isInternal: (sid: string) => this.internalSessionRoles.has(sid),
          });
          let generated = 0;
          for (const sid of sids) {
            if (!this.getPipelineBudget().allow('dream')) break;
            const turns = db.listTurns(sid).slice(-20);
            const tail = turns
              .flatMap((t: any) => db.readTurn(sid, t.turn_id))
              .map((o: any) => o.content)
              .filter(Boolean)
              .join('\n')
              .slice(-3000);
            if (!tail.trim()) continue;
            const worker = this.getPool().getWorker(`dream-${sid}`, 'reflect');
            const reply = await worker.prompt(`SESSION TAIL:\n${tail}`, DREAM_SYSTEM, config.recall.workerModel, 'memory-curator');
            const queries = parseDreamQueries(reply, 3);
            if (queries.length > 0) {
              db.kvSet('dream-queries', sid, { queries, generatedAt: Date.now() });
              generated++;
            }
          }
          this.heartbeat?.record('memory:dream', { ok: true, counts: { sessions: sids.length, generated } });
        } catch (err: any) {
          this.heartbeat?.record('memory:dream', { ok: false, error: err.message });
          log.warn(`[Dream] run failed: ${err.message}`);
        }
      }, { budget: { kind: 'pipeline', pipeline: 'dream' } });
    // A1: weekly axiom distillation — high-need semantic insights become axiom
    // candidates queued for human triage; confirmation commits them to L5.
    engine.registerAction('memory:axiomDistill', async () => {
        try {
          if (!this.memoryService) return;
          const { selectAxiomSources, parseAxiomCandidates, AXIOM_SYSTEM } = require('./memory/axiom-distill');
          const sources = selectAxiomSources(
            this.memoryService.harmonicIndex.getIndex().entries,
            (id: string) => getRetrievalEventBuffer().needFor(id),
            { now: Date.now(), minAgeDays: 14, cap: 20 },
          );
          let created = 0;
          if (sources.length >= 3 && this.getPipelineBudget().allow('axiomDistill')) {
            const evidence = sources.map((e: any) => `- [${e.id}] ${e.primary_abstraction}`).join('\n');
            const worker = this.getPool().getWorker('axiom-distill', 'reflect');
            const reply = await worker.prompt(evidence, AXIOM_SYSTEM, config.recall.workerModel, 'memory-curator');
            const candidates = parseAxiomCandidates(reply, 3);
            if (candidates.length > 0) {
              const triageDir = path.join(this.mafwDir, 'triage');
              fs.mkdirSync(triageDir, { recursive: true });
              const triageId = `triage-axiom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              fs.writeFileSync(path.join(triageDir, `${triageId}.json`), JSON.stringify({
                id: triageId,
                automationId: 'axiom-distill',
                discoveredAt: new Date().toISOString(),
                source: 'axiom-distill',
                summary: { axiomDraft: {
                  candidates,
                  sourceIds: sources.map((e: any) => e.id),
                  // G1: floor = LOWEST authority among source insights,
                  // surfaced to the human reviewer — pipeline-distilled axioms
                  // stay visibly inferred even after promotion to L5.
                  authorityFloor: sources.some((e: any) => (e.authority ?? 'pipeline') === 'pipeline')
                    ? 'pipeline'
                    : sources.some((e: any) => (e.authority ?? 'pipeline') !== 'user') ? 'agent' : 'user',
                } },
                state: 'PENDING_CONFIRMATION',
                userAction: null,
                deadline: new Date(Date.now() + 7 * 86400e3).toISOString(),
                updatedAt: new Date().toISOString(),
              }, null, 2), 'utf-8');
              created = candidates.length;
            }
          }
          this.heartbeat?.record('memory:axiomDistill', { ok: true, counts: { sources: sources.length, candidates: created } });
        } catch (err: any) {
          this.heartbeat?.record('memory:axiomDistill', { ok: false, error: err.message });
          log.warn(`[AxiomDistill] run failed: ${err.message}`);
        }
      }, { budget: { kind: 'pipeline', pipeline: 'axiomDistill' } });
    // W2: skill promotion — procedural memories passing G1-G5 become staged
    // SKILL.md drafts + triage items for human approval (weekly).
    engine.registerAction('memory:skillPromotion', async () => {
        try {
          if (!this.memoryService) return;
          const stagingDir = path.join(this.mafwDir, 'skill-staging');
          const triageDir = path.join(this.mafwDir, 'triage');
          const store = new HarmonicUnitFileStore(config.resolvePath(), this.memoryService.harmonicIndex);
          const { scanPromotionCandidates } = require('./memory/skill-promotion');
          const promoted = await scanPromotionCandidates({
            getIndex: () => this.memoryService!.harmonicIndex.getIndex(),
            readUnit: async (id: string) => {
              const u = await store.read(id);
              return u ? { id: u.id, memory_value: u.memory_value, cue_anchors: u.cue_anchors } : null;
            },
            needFor: (id: string) => getRetrievalEventBuffer().needFor(id),
            existingSkillCount: () => this.installedSkillCount(),
            writeStaging: (name: string, content: string) => {
              const dir = path.join(stagingDir, name);
              fs.mkdirSync(dir, { recursive: true });
              fs.writeFileSync(path.join(dir, 'SKILL.md'), content, 'utf-8');
            },
            createTriageItem: (item: any) => {
              fs.mkdirSync(triageDir, { recursive: true });
              const triageId = `triage-skillpromo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              fs.writeFileSync(path.join(triageDir, `${triageId}.json`), JSON.stringify({
                id: triageId,
                automationId: 'skill-promotion',
                discoveredAt: new Date().toISOString(),
                source: 'skill-promotion',
                summary: item.summary,
                proposedGoal: { title: `物化 skill: ${item.summary.skillDraft.name}`, boundaries: [], estimatedLoops: 1 },
                state: 'PENDING_CONFIRMATION',
                userAction: null,
                deadline: new Date(Date.now() + 7 * 86400e3).toISOString(),
                updatedAt: new Date().toISOString(),
              }, null, 2), 'utf-8');
            },
            now: new Date(),
          });
          this.heartbeat?.record('memory:skillPromotion', { ok: true, counts: { promoted } });
          if (promoted > 0) log.info(`[SkillPromotion] staged ${promoted} skill draft(s)`);
        } catch (err: any) {
          this.heartbeat?.record('memory:skillPromotion', { ok: false, error: err.message });
          log.warn(`[SkillPromotion] run failed: ${err.message}`);
        }
      });
    });
  }

  /** 用户级 skills 目录（W2 安装目标）。 */
  private skillsDir(): string {
    return path.join(os.homedir(), '.config', 'opencode', 'skills');
  }

  /** 已安装 skill 数（含 staging 之外的用户级目录）——G5 列表膨胀闸门的输入。 */
  private installedSkillCount(): number {
    try {
      return fs.readdirSync(this.skillsDir(), { withFileTypes: true })
        .filter((d) => d.isDirectory()).length;
    } catch {
      return 0;
    }
  }

  /** W2 安装器 deps：staging→用户级 skills 目录 + 源记忆指针改写。 */
  private skillInstallDeps(): {
    copyDir(src: string, dst: string): void;
    readMemory(id: string): Promise<{ id: string; memory_value: string; cue_anchors?: string[] } | null>;
    writeMemory(unit: { id: string; memory_value: string; cue_anchors?: string[] }): Promise<unknown>;
    stagingDir: string;
    skillsDir: string;
  } {
    const mafwDir = this.mafwDir;
    const store = this.memoryService
      ? new HarmonicUnitFileStore(config.resolvePath(), this.memoryService.harmonicIndex)
      : null;
    return {
      copyDir: (src, dst) => fs.cpSync(src, dst, { recursive: true }),
      readMemory: async (id) => {
        if (!store) return null;
        const u = await store.read(id);
        return u ? { id: u.id, memory_value: u.memory_value, cue_anchors: u.cue_anchors } : null;
      },
      writeMemory: async (unit) => {
        if (store) await store.write(unit as any);
      },
      stagingDir: path.join(mafwDir, 'skill-staging'),
      skillsDir: this.skillsDir(),
    };
  }

  private getStaleVerifyPipeline(): StaleVerifyPipeline {
    if (!this.memoryService) throw new Error('memoryService not ready');
    const store = new HarmonicUnitFileStore(config.resolvePath(), this.memoryService.harmonicIndex);
    return new StaleVerifyPipeline({
      index: this.memoryService.harmonicIndex,
      readMemory: async (id) => {
        const unit = await store.read(id);
        return unit ? { id: unit.id, memory_value: unit.memory_value } : null;
      },
      worker: this.getPool().getWorker('stale-verify', 'reflect'),
      workerModel: config.recall.workerModel,
      budget: this.getPipelineBudget(),
    });
  }

  private schemaClustersCache: { at: number; clusters: Cluster[] } | null = null;

  /** S2: build (cached 5min) semantic schema clusters from the shared index. */
  private getSchemaClusters(): Cluster[] {
    try {
      const now = Date.now();
      if (this.schemaClustersCache && now - this.schemaClustersCache.at < 5 * 60_000) {
        return this.schemaClustersCache.clusters;
      }
      const rt = getEmbeddingRuntime();
      if (!rt || !this.memoryService) return [];
      const members: Array<{ id: string; vector: number[]; weight: number }> = [];
      for (const e of this.memoryService.harmonicIndex.getIndex().entries) {
        if (e.type !== 'semantic' || e.superseded_by) continue;
        const v = rt.vectors.get(e.id);
        if (v) members.push({ id: e.id, vector: v, weight: (e.energy ?? 0.8) * (e.salience ?? 1) });
      }
      const clusters = buildSchemaClusters(members, config.memory.embedding.minCosine);
      this.schemaClustersCache = { at: now, clusters };
      return clusters;
    } catch {
      return [];
    }
  }

  private getTurnPipeline(): TurnPipeline {
    if (!this.memoryService) throw new Error('memoryService not ready');
    return new TurnPipeline({
      t1db: this.getGatewayDb(),
      index: this.memoryService.harmonicIndex,
      workerFor: (sessionID) => this.getPool().getWorker(sessionID, 'extract'),
      staleMs: config.recall.turnStaleMs,
      workerModel: config.recall.workerModel,
      // V2 ②/③: TCM boundary shadow log + event-segment verbatim input
      // (A/B day parity) — flags from config.recall.
      segmentation: config.recall?.segmentation ?? 'shadow',
      eventSegmentInput: config.recall?.eventSegmentInput === true,
      // Interleaved replay (CLS): recall cross-session prior knowledge into the
      // worker prompt so the curator reconciles rather than only creating.
      replayK: 5,
      replayMaxChars: 1500,
      // B1: the "need" term of the replay priority (need × gain × 1/energy) —
      // 7-day retrieval hit counts from the shared event buffer.
      needFor: (id) => getRetrievalEventBuffer().needFor(id),
      transcriptMaxChars: config.recall.workerTranscriptMaxChars,
      // S2: schema-cluster interleaving (integrate into schemas, not append).
      schemaClusters: () => this.getSchemaClusters(),
      clusterVector: async (obs) => {
        try {
          const rt = getEmbeddingRuntime();
          if (!rt) return undefined;
          const text = obs.map((o) => o.content).join(' ').slice(0, 2000);
          if (!text.trim()) return undefined;
          const [v] = await rt.provider.embed([text], 'query');
          return v ?? undefined;
        } catch {
          return undefined;
        }
      },
      // Outcome-feedback signal (env-probing curation, grade gi): lets the
      // curator calibrate trust in the trajectory — a failed goal means its
      // "lessons" need verification before they become memories.
      gradeFor: (sessionID) => {
        try {
          const o = this.getGatewayDb().getOutcomeForSession(sessionID);
          if (!o) return null;
          return (
            `Goal ${o.goal_id} archived with verdict=${o.verdict} ` +
            `(thumbs_up=${o.thumbs_up}, thumbs_down=${o.thumbs_down})` +
            (o.failure_kind ? `, failure_kind=${o.failure_kind}` : '')
          );
        } catch {
          return null;
        }
      },
      budget: this.getPipelineBudget(),
    });
  }

  private getReflectPipeline(): ReflectionPipeline {
    if (!this.memoryService) throw new Error('memoryService not ready');
    const pool = this.getPool();
    return new ReflectionPipeline({
      index: this.memoryService.harmonicIndex,
      baseDir: config.resolvePath(),
      workerFor: (sessionID) => pool.getWorker(sessionID, 'reflect'),
      cursor: this.getReflectCursor(),
      maxEpisodicPerSession: config.recall.maxEpisodicPerReflect,
      exclusive: (sessionID, fn) => pool.runExclusive(sessionID, 'reflect', fn),
      workerModel: config.recall.workerModel,
      // A4: selection-pressure feedback — prior insights' 7-day retrieval hits.
      needFor: (id: string) => getRetrievalEventBuffer().needFor(id),
      budget: this.getPipelineBudget(),
    });
  }

  /**
   * Worker-state recovery after a session goes idle and its workers are
   * evicted: if a session accumulated unreflected episodes while offline, kick
   * an immediate reflection instead of waiting for the daily cron.
   */
  private restoreWorkerState(): void {
    try {
      if (!this.memoryService) return;
      const sessions = new Set<string>();
      for (const turn of this.getGatewayDb().listTurns()) sessions.add(turn.session_id);
      const pipeline = this.getReflectPipeline();
      for (const sessionID of sessions) {
        const pending = pipeline.pendingFor(sessionID);
        if (pending < config.recall.reflectThresholdEpisodic) continue;
        const pool = this.getPool();
        void pool.runExclusive(sessionID, 'reflect', async () => {
          const res = await pipeline.runSession(sessionID);
          log.info(
            `[Reflection:restore] session=${sessionID} reviewed=${res.reviewed} distilled=${res.distilled} deduped=${res.deduped}`,
          );
        }).catch((err: any) => log.warn(`[Reflection:restore] session=${sessionID} failed: ${err.message}`));
      }
    } catch (err: any) {
      log.warn(`[Reflection:restore] failed (non-fatal): ${err.message}`);
    }
  }

  private broadcast(event: { type: string; [key: string]: any }): void {
    log.info(`[SSE] broadcast ${event.type} clients=${this.sseClients.size}`);
    // 持久事件日志（spec 2026-10-22）：同步分配单调 seq（part.delta 不入库不占 seq）。
    // append 失败/缺席 → seq null → 无 id: 行（现状形状，fail-open）。
    const seq = this.eventStore?.append(event) ?? null;
    const enriched = enrichBroadcastFrame(event, seq, new Date().toISOString());
    const data = (seq !== null ? `id: ${seq}\n` : '') + `data: ${JSON.stringify(enriched)}\n\n`;
    for (const [client, write] of this.sseClients) {
      try { write(data, seq); } catch { this.sseClients.delete(client); }
    }
    // WebSocket clients receive the same events as JSON frames (seq additive).
    const frame = JSON.stringify(enriched);
    for (const ws of this.wsClients) {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(frame); } catch { this.wsClients.delete(ws); }
      }
    }
    // Push to registered mobile devices via PushGateway (online WS + offline fallback)
    this.pushGateway?.onBroadcast(enriched).catch((err: any) => {
      log.warn(`[PushGateway] broadcast failed: ${err.message}`);
    });
    // 摊销裁剪（每 pruneEveryN 次 append 检查一次；异常吞掉 fail-open）
    this.eventStore?.maybePrune(config.events.logRetention, config.events.pruneEveryN);
  }

  /** Upstream WebSocket messages: { type: 'send', sessionID?, message, parts?, agent?, model? }. */
  private async handleWsMessage(ws: WebSocket, raw: Buffer | ArrayBuffer | Buffer[]): Promise<void> {
    let msg: any;
    try {
      msg = JSON.parse(Buffer.isBuffer(raw) ? raw.toString() : String(raw));
    } catch {
      ws.send(JSON.stringify({ type: 'ws_error', error: 'invalid JSON' }));
      return;
    }
    if (msg?.type === 'send') {
      const { sessionID, message, parts, agent, model } = msg;
      if (typeof message !== 'string' && !Array.isArray(parts)) {
        ws.send(JSON.stringify({ type: 'ws_error', error: 'message or parts required' }));
        return;
      }
      if (sessionID && this.runCoordinator?.shouldHoldQueue(sessionID)) {
        ws.send(JSON.stringify({ type: 'ws_error', error: 'session is suspended; resume or discard the run first' }));
        return;
      }
      try {
        const result = await this.sendEnrichedInternal(message, sessionID, parts, agent, model);
        ws.send(JSON.stringify({ type: 'send_ack', sessionID: result.sessionID }));
      } catch (err: any) {
        ws.send(JSON.stringify({ type: 'ws_error', error: err?.message || String(err) }));
      }
      return;
    }
    ws.send(JSON.stringify({ type: 'ws_error', error: `unknown message type: ${msg?.type}` }));
  }

  /**
   * Enriched chat send (memory injection + promptAsync). Shared by the WS
   * upstream path; the HTTP /api/chat/enriched route keeps its own inline copy
   * for stability.
   */
  private async sendEnrichedInternal(
    message: string,
    existingID?: string,
    parts?: any[],
    agent?: string,
    model?: any,
  ): Promise<{ sessionID: string }> {
    const firstProject = this.registeredProjects.values().next().value;
    const projectDir = firstProject?.projectDir || this.projectDir;
    if (!this.runtime) throw new Error('LLM client not available');

    let enrichedMessage = message;
    if (this.memoryService) {
      const results = await this.memoryService.mergedSearch(message, 5);
      if (results.length > 0) {
        const { renderMemoryBlocks } = require('./recall/inject-format');
        const chunks = renderMemoryBlocks(results.map((r: any) => ({
          source: r.source,
          type: r.type,
          content: r.content,
        })));
        if (chunks.length > 0) enrichedMessage = chunks.join('\n\n') + '\n\n' + message;
      }
    }

    const sessionID = existingID || (await this.runtime.session.create({ directory: projectDir })).id;
    if (!sessionID) throw new Error('Failed to create session');
    const promptParts: any[] = [];
    if (enrichedMessage) promptParts.push({ type: 'text', text: enrichedMessage });
    if (Array.isArray(parts) && parts.length > 0) promptParts.push(...parts);
    const promptOpts: any = { sessionID, parts: promptParts };
    if (agent) promptOpts.agent = agent;
    if (model?.providerID && model?.modelID) promptOpts.model = model;
    const result = await this.runtime.session.promptAsync(promptOpts);
    if (result?.error) {
      throw new Error('promptAsync failed: ' + (result.error?.data?.message || result.error?.message || JSON.stringify(result.error)));
    }
    return { sessionID };
  }

  stop() {
    this.running = false;
    this.taskService?.dispose();
    this.kernels?.disposeAll();
    try { this.layaSidecar?.kill(); } catch { /* best effort */ }
    try { this.voiceSidecar?.stopSync(); } catch { /* best effort */ }
    this.voiceSidecar = undefined;
    this.milestonePush?.dispose();
    this.budgetGuards.clear();
    this.customCommandWatcherDispose?.();
    this.customCommandWatcherDispose = null;
    // Give an in-flight pipeline a short window to settle before closing the
    // T1 store (closing mid-run would leave turns un-deleted → duplicate
    // extraction on next start), then dispose workers best-effort.
    // Scheduler stats are at least as strict as the old pipelineGuard: running
    // covers every in-flight task (pipeline actions, compact flushes, snapshot
    // builds); the 5s cap bounds the wait either way.
    const settle = new Promise<void>((resolve) => {
      const started = Date.now();
      const check = () => {
        if (this.scheduler.stats().running === 0 || Date.now() - started > 5000) resolve();
        else setTimeout(check, 100);
      };
      check();
    });
    void settle.then(() => {
      try { this.gatewayDbInstance?.close(); this.gatewayDbInstance = null; } catch { /* ignore */ }
      void this.workerPool?.disposeAll();
      void this.scanService?.dispose();
    });
    if (this.serveInstance) {
      this.serveInstance.close();
      this.serveInstance = undefined;
    }
    this.serveOwned = false;
    this.stopServeWatchdog();
    // Cancel the active event stream subscription to break the async iterator loop.
    if (this.eventStreamAbort) {
      this.eventStreamAbort.abort();
      this.eventStreamAbort = null;
    }
    if (this.stopTokenWatcher) {
      this.stopTokenWatcher();
      this.stopTokenWatcher = null;
    }
    if (this.serveRetryTimer) {
      clearTimeout(this.serveRetryTimer);
      this.serveRetryTimer = null;
    }
    if (this.serveStableTimer) {
      clearTimeout(this.serveStableTimer);
      this.serveStableTimer = null;
    }
    if (this.automationEngine) {
      this.automationEngine.stop();
    }
    this.pluginLoader?.stop();
    this.mediaPluginLoader?.stop();
    this.ttsPluginLoader?.stop();
  this.pluginHost?.stop();
    if (this.runtime && typeof (this.runtime as any).dispose === 'function') {
      void (this.runtime as any).dispose().catch((err: any) => {
        log.warn(`[Scheduler] runtime dispose error: ${err?.message ?? String(err)}`);
      });
    }
    this.pushGateway?.destroy();
    this.pairingService?.destroy();
    this.mdnsAdvertiser?.stop();
    // if (this.dashboard) {
    //   this.dashboard.stop();
    // }
    void this.releaseInstanceOwnership();
    log.info('[Scheduler] Stopping...');
  }

  /** Graceful shutdown that also releases the instance lease before exit. */
  async shutdown() {
    this.stop();
    await this.releaseInstanceOwnership();
  }

  // 鈹€鈹€ Services & Event Bus 鈹€鈹€

  private async initServices() {
    const projectDir = this.projectDir;
    const mafwDir = config.resolvePath();
    this.mafwDir = mafwDir;

    // Approval policy（spec docs/superpowers/specs/2026-09-18-gateway-approval-policy-design.md
    // + 切片 1 三档化）：持久规则（~/.mafw/permission-rules.json，新）+ legacy 白名单
    // （config.yaml approval 段，双读过渡）+ per-session 三档 mode（kv perm-mode）。
    this.allowlistStore = new AllowlistStore({
      readRawAllowlist: () => (config.raw as any)?.approval?.allowlist,
      persist: (o) => config.persistOverrides(o as any),
    });
    this.permissionRules = new PermissionRulesStore(mafwDir);
    this.approvalPolicy = new ApprovalPolicyService({
      getInternalRole: (sid) => this.internalSessionRoles.get(sid),
      allowlistMatches: (toolName, candidate) =>
        this.permissionRules.matches(toolName, candidate) || this.allowlistStore.matches(toolName, candidate),
      loadMode: async (sid) => {
        const raw = this.getGatewayDb().kvGet<string>('perm-mode', sid);
        return raw ? (normalizeMode(raw) as SessionPermissionMode) : 'read-only';
      },
      saveMode: async (sid, mode) => { this.getGatewayDb().kvSet('perm-mode', sid, mode); },
      onModeChanged: (sid, mode, reason) => {
        this.broadcast(mafwBroadcast({ type: MAFW.permissionMode, properties: { mode, reason }, sessionID: sid }));
      },
      getIdentity: (sid) => {
        const b = this.identityState.get(sid);
        if (!b) return undefined;
        return { name: b.identity, internal: this.internalSessionRoles.has(sid) };
      },
      getPolicy: (name) => this.identityRegistry.get(name)?.policy,
      // Task 14：Spike 探针会话必须过 ProbeScopeGuard（先于身份与 internal blanket）。
      getProbeScope: (sid) => this.probeScopes.get(sid),
    });

    this.sdkSession = new SdkSessionResource(undefined, mafwDir);
    this.sessionConfigService = new SessionConfigService({
      load: (sid) => this.getGatewayDb().kvGet('session-config', sid) ?? undefined,
      save: (sid, state) => { this.getGatewayDb().kvSet('session-config', sid, state); },
      getMode: (sid) => this.approvalPolicy.getMode(sid),
      setMode: (sid, mode) => this.approvalPolicy.setMode(sid, mode),
      getSession: async (sid) => {
        if (!this.runtime) throw new SessionConfigError(503, 'runtime not available');
        return this.runtime.session.get({ sessionID: sid });
      },
      switchAgent: async (sid, agent) => {
        const fn = this.runtime?.session.switchAgent;
        if (!fn) throw new SessionConfigError(503, 'runtime does not implement session.switchAgent');
        await fn({ sessionID: sid, agent });
      },
      switchModel: async (sid, model, variant) => {
        const fn = this.runtime?.session.switchModel;
        if (!fn) throw new SessionConfigError(503, 'runtime does not implement session.switchModel');
        await fn({ sessionID: sid, model, ...(variant ? { variant } : {}) });
      },
      setThinkingLevel: async (sid, level) => {
        const fn = this.runtime?.session.setThinkingLevel;
        if (!fn) throw new SessionConfigError(400, 'runtime does not implement session.setThinkingLevel');
        await fn({ sessionID: sid, level });
      },
      // 契约面探针（RuntimeAccess.can）：runtime 只声明/实现 surface，业务不摸 runtime 内部。
      // runtime 的内部档位实现（如模型变体）不进入契约面；未实现该 surface → false。
      supportsThinkingLevel: () => {
        try { return this.runtime?.access?.can('session.setThinkingLevel') === true; } catch { return false; }
      },
      emit: (sid, state, category) => {
        this.broadcast(mafwBroadcast({
          type: MAFW.sessionConfig,
          properties: { sessionID: sid, config: state, category },
          sessionID: sid,
        }));
      },
    });
    this.checkpointService = new CheckpointService({
      db: this.getGatewayDb(),
      runtime: {
        session: {
          get: async (o) => {
            if (!this.runtime) throw new Error('runtime not available');
            return this.runtime.session.get(o);
          },
          messages: async (o) => {
            if (!this.runtime) throw new Error('runtime not available');
            return this.runtime.session.messages(o);
          },
          revert: async (o) => {
            const fn = this.runtime?.session.revert;
            if (!fn) throw new Error('runtime does not implement session.revert');
            return fn(o);
          },
        },
        // 快照树定位归 adapter（session.snapshotTree）；缺失时 restore 显式 503。
        snapshotTree: {
          locate: async (o) => {
            const channel = this.runtime?.snapshotTree;
            if (!channel) throw new Error('runtime does not support session.snapshotTree');
            return channel.locate(o);
          },
        },
      },
      git: defaultGit,
      porcelainOf: (dir) => this.checkpointPorcelainOf(dir),
      readWorkspaceTree: (sid) => this.getGatewayDb().kvGet<string>('checkpoint-workspace', sid) ?? null,
      writeWorkspaceTree: (sid, tree) => {
        if (tree) this.getGatewayDb().kvSet('checkpoint-workspace', sid, tree);
        else this.getGatewayDb().kvDelete('checkpoint-workspace', sid);
      },
      broadcast: (e) => this.broadcast(mafwBroadcast({
        type: e.type,
        properties: e.properties,
        sessionID: e.sessionID,
      })),
      now: () => new Date().toISOString(),
      newId: () => `ckpt_${randomUUID()}`,
    });
    // 文件级历史（非 git/二进制/Office）：写入前 copy-on-write，git checkpoint 的补充。
    this.fileHistory = new FileHistoryService(config.resolvePath('file-history'));
    this.runStateService = new RunStateService({
      db: this.getGatewayDb(),
      broadcast: (e) => this.broadcast(mafwBroadcast({
        type: e.type,
        properties: e.properties,
        sessionID: e.sessionID,
      })),
      now: () => new Date().toISOString(),
      newId: () => `run_${randomUUID()}`,
      eventName: MAFW.runUpdated,
    });
    this.runCoordinator = new RunCoordinator({
      runtime: () => this.runtime,
      access: () => this.runtime?.access ?? null,
      service: this.runStateService,
      isBusy: (sid) => this.busySessions.has(sid),
      queueSize: (sid) => this.sessionQueue.size(sid),
      flushQueue: (sid) => this.flushSessionQueue(sid),
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      log: (message) => log.info(message),
    });
    // 启动恢复：suspended 重挂闸门；resumed 僵尸 → cancelled。
    this.runCoordinator.reconcile();
    this.dataPartService = new DataPartService({
      db: this.getGatewayDb(),
      runtime: () => this.runtime,
      broadcast: (e) => this.broadcast(mafwBroadcast({
        type: e.type,
        properties: e.properties,
        sessionID: e.sessionID,
      })),
      now: () => new Date().toISOString(),
    });
    this.subagentService = new SubagentService({
      createSession: (o) => this.runtime!.session.create(o),
      getSession: (sid) => this.runtime!.session.get({ sessionID: sid }),
      children: (parentID) => this.runtime!.session.children({ sessionID: parentID }),
      promptChild: (o) => this.sdkSession.promptAsync(o.sessionID, o.prompt, undefined, o.agent, o.model, o.outputSchema),
      messageChild: async (sid, text) => {
        await this.runtime!.session.promptAsync({ sessionID: sid, parts: [{ type: 'text', text }], delivery: 'queue' });
      },
      abortChild: (sid) => this.runtime!.session.abort({ sessionID: sid }),
      messages: (sid, limit) => this.runtime!.session.messages({ sessionID: sid, limit }),
      submitted: (sid) => structuredOutput.submitted(sid),
      broadcast: (e) => this.broadcast(e),
    });

    this.podStore = new PodStore(this.getGatewayDb().getStore());
    this.podEventService = new PodEventService({ store: this.podStore, mafwDir: this.mafwDir });
    // Retention: p3 is informational; drop old seen p3 rows + audit files once a day
    // (and once at startup so a long-idle install catches up immediately).
    const prunePodEvents = () => {
      try {
        const out = this.podEventService?.prune();
        if (out && (out.events > 0 || out.files > 0)) {
          log.info(`[Pod] pruned ${out.events} stale p3 event(s), ${out.files} audit file(s)`);
        }
      } catch (err: any) {
        log.warn(`[Pod] event prune failed (non-fatal): ${err?.message ?? err}`);
      }
    };
    prunePodEvents();
    setInterval(prunePodEvents, 24 * 60 * 60 * 1000).unref?.();
    this.podEventWake = new PodEventWake({
      events: this.podEventService,
      leadMemberId: (podId) => this.podStore?.getMemberByRole(podId, 'lead')?.id ?? null,
      ensureLead: async (podId) => ({
        sessionId: (await this.podService!.ensureLead(podId)).sessionId,
      }),
      isBusy: (sessionId) => this.busySessions.has(sessionId),
      isSuspended: (sessionId) => this.runStateService?.active(sessionId)?.status === 'suspended',
      isPodPaused: (podId) => this.podStore?.getPod(podId)?.status === 'paused',
      promptAsync: async (input) => {
        await this.runtime!.session.promptAsync({
          sessionID: input.sessionID,
          parts: [{ type: 'text', text: input.message }],
        });
      },
      deliveryDelivered: (messageId, memberId) => this.podStore?.hasDelivery(messageId, memberId) ?? false,
      commitDelivered: (ids, sessionId) => this.podMessageDelivery?.commitDelivered(ids, sessionId),
      // B2: coalesce scans via the unified scheduler — the 60s timer scan and a
      // p2-notify scan landing together join the in-flight one (no double delivery).
      // No task id: the scheduler's auto-id (task_<seq>) is collision-free.
      runScan: (fn) => this.scheduler.submit(
        { priority: 'midground', mutexKey: 'pod-event-wake', strategy: 'coalesce' },
        fn,
      ),
    });
    setInterval(() => { void this.podEventWake?.scan(); }, 60_000).unref?.();
    setTimeout(() => { void this.podEventWake?.scan(); }, 5_000).unref?.();
    // Agent messages reach the store through the A2A bridge, not through
    // PodMessageService — the hook must live on the store or p2 never fires.
    this.podStore.onMessageInserted((row) => {
      try {
        const lead = this.podStore?.getMemberByRole(row.podId, 'lead') ?? null;
        const cls = classifyMemberMessage({
          kind: row.kind,
          toMemberId: row.toMemberId,
          leadMemberId: lead?.id ?? null,
        });
        const pod = this.podStore?.getPod(row.podId);
        const evt = this.podEventService?.record({
          ...cls,
          podId: row.podId,
          projectId: pod?.projectDir ?? '',
          goalId: null,
          revision: null,
          title: `[${cls.kind}] ${row.body.slice(0, 60)}`,
          summary: row.body.slice(0, 400),
          refs: [{ kind: 'message', id: row.id }],
          dedupeKey: memberDedupeKey(row.kind, row.id, row.toMemberId),
        });
        if (evt) {
          this.broadcast({
            type: 'pod.event',
            properties: {
              podId: evt.podId, eventId: evt.id, goalId: evt.goalId,
              revision: evt.revision, kind: evt.kind, severity: evt.severity,
            },
          });
          if (evt.severity === 'p2') this.podEventWake?.notify();
        }
      } catch (err: any) {
        log.warn(`[Pod] event write failed for message ${row.id} (non-fatal): ${err?.message ?? err}`);
      }
    });
    this.leadSessionRegistry = new LeadSessionRegistry({
      kvGet: (scope, key) => this.getGatewayDb().kvGet(scope, key),
      kvSet: (scope, key, value) => this.getGatewayDb().kvSet(scope, key, value),
      kvAll: <T,>(scope: string) => this.getGatewayDb().kvAll<T>(scope),
      runtimeName: () => this.runtimeName,
      podByProject: (dir) => {
        const pod = this.podStore.getPodByProject(dir);
        return pod ? { podId: pod.id, projectDir: pod.projectDir } : null;
      },
      activePodCoordination: (podId) => {
        const lead = this.podStore.getMemberByRole(podId, 'lead');
        if (!lead) return null;
        const row = this.podStore.listSessions(podId).find((session) =>
          session.memberId === lead.id
          && session.node === 'coordination'
          && !session.endedAt
          && session.runtime === this.runtimeName,
        );
        return row ? { sessionId: row.sessionId } : null;
      },
      createSession: async (dir) => {
        if (!this.runtime) throw new Error('runtime not available');
        const created = await this.runtime.session.create({ directory: dir });
        if (!created.id) throw new Error('Failed to create lead session: no id returned');
        return created.id;
      },
      isAlive: async (sessionId) => {
        try {
          const info = await this.runtime!.session.get({ sessionID: sessionId });
          return isLiveSessionInfo(info);
        } catch (err: any) {
          const message = String(err?.message ?? err);
          if (/not found|404|gone|missing|deleted|no such/i.test(message)) return false;
          throw err;
        }
      },
      registerLead: async (sessionId, dir) => {
        this.registerInternalSession(sessionId, 'lead', resolveIdentityAlias('manager'));
        await this.sdkSession.registerExternal(sessionId, dir, projectLeadSessionMetadata())
          .catch((err: any) => log.warn(`[Scheduler] Lead local register failed: ${err?.message ?? err} (non-fatal)`));
      },
      archiveLead: (sessionId) => this.archiveLeadSession(sessionId),
      bindPodLead: async (podId, sessionId) => {
        await this.podService?.bindLead(podId, sessionId);
      },
      now: () => new Date().toISOString(),
      log: (message) => log.info(message),
      // Phase C Task 5: observe-only mirror into the unified session registry.
      sessionRegistry: this.sessionRegistry,
    });
    this.podProbeService = new PodProbeService({
      store: this.podStore,
      resolveMafwDir: (goalId) => this.findGoalMafwDir(goalId),
      now: () => new Date().toISOString(),
      newId: () => `probe_${randomUUID()}`,
      notify: (podId) => this.broadcast({ type: 'pod.updated', properties: { podId, kind: 'probe' } }),
      log: (message) => log.info(message),
    });
    this.podProbeWorkspaces = new ProbeWorkspaceFactory();
    this.podMemoryService = new PodMemoryService({
      memoryRoot: path.join(os.homedir(), '.mafw', 'pods'),
      now: () => new Date().toISOString(),
    });
    this.podService = new PodService({
      store: this.podStore,
      now: () => new Date().toISOString(),
      newId: () => `pod_${randomUUID()}`,
      broadcast: (event) => this.broadcast(event as any),
      currentRuntime: () => this.runtimeName,
      getManagerSession: (dir) => {
        const canonical = canonicalProjectDir(dir);
        const entry = Array.from(this.registeredProjects.entries())
          .find(([raw]) => canonicalProjectDir(raw) === canonical);
        const projectRoot = entry?.[0] ?? dir;
        return this.ensureManagerSession(projectRoot, entry?.[1].mafwDir ?? this.mafwDirFor(projectRoot));
      },
      getSession: async (sessionID) => {
        const info = await this.runtime!.session.get({ sessionID });
        return isLiveSessionInfo(info) ? info : null;
      },
      messages: (sessionID, limit) => this.runtime!.session.messages({ sessionID, limit }).then((r: any) => r?.data ?? []),
      archiveLeadSession: (sessionId) => this.archiveLeadSession(sessionId),
      memoryRoot: path.join(os.homedir(), '.mafw', 'pods'),
      listRegisteredProjectDirs: () => Array.from(this.registeredProjects.keys()),
      ensureMemory: (podId, projectName) => this.podMemoryService.ensurePodMemory(podId, projectName),
      log: (message) => log.info(message),
    });
    this.podWorktreeService = new PodWorktreeService({
      store: this.podStore,
      now: () => new Date().toISOString(),
      log: (message) => log.info(message),
    });
    this.podTaskService = new PodTaskService({
      store: this.podStore,
      now: () => new Date().toISOString(),
      newId: () => `podtask_${randomUUID()}`,
      notify: (podId) => this.broadcast({ type: 'pod.updated', properties: { podId, kind: 'task' } }),
      // 计划任务编辑：定位 goal 的 waves.json + 运行态门（nodeSession/终态）。
      resolveGoalPlan: (goalId) => {
        const found = this.findGoalStatePath(goalId);
        if (!found) return null;
        const state = loadGoalState(found.info.mafwDir, goalId);
        if (!state) return null;
        return {
          wavesPath: state.wavePlanPath
            ?? nodeArtifactPaths(found.info.mafwDir, goalId, state.round, { revision: effectiveRevision(state) }).waves,
          nextAction: state.nextAction,
          nodeSession: state.nodeSession,
        };
      },
      // Task 13：计划任务被编辑/新增/删除 → 批准绑定的内容版本失效。
      invalidatePlanApproval: (goalId) => { this.goalDriver?.refreshPlanApproval(goalId); },
    });
    this.podMessageService = new PodMessageService({
      store: this.podStore,
      now: () => new Date().toISOString(),
      newId: () => `podmsg_${randomUUID()}`,
      notify: (podId) => this.broadcast({ type: 'pod.updated', properties: { podId, kind: 'message' } }),
    });
    this.podAccess = new PodAccess(this.podStore, () => this.runtimeName);
    this.podBudget = new PodBudget({
      store: this.podStore,
      costForSessions: (sessionIds, sinceEpoch) => {
        if (sessionIds.length === 0) return 0;
        const placeholders = sessionIds.map(() => '?').join(', ');
        try {
          const row = this.getGatewayDb().getStore().prepare(
            `SELECT COALESCE(SUM(cost), 0) AS cost FROM trajectory_turns WHERE session_id IN (${placeholders}) AND created_at >= ?`,
          ).get(...sessionIds, sinceEpoch) as { cost?: number } | undefined;
          return row?.cost ?? 0;
        } catch {
          return 0;
        }
      },
      dailyUsd: () => Number((config.raw as any)?.pod?.dailyUsd ?? 0),
      nowEpoch: () => Math.floor(Date.now() / 1000),
    });
    this.podGoalRevisionService = new PodGoalRevisionService({
      store: this.podStore,
      resolveMafwDir: (goalId) => this.findGoalMafwDir(goalId),
      now: () => new Date().toISOString(),
      resultForGoal: (goalId) => this.readPodGoalResult(goalId),
      onRevisionClosed: async (goalId, revision) => {
        await this.podSessionLifecycle.retireRevision(goalId, revision);
      },
      notify: (podId, kind = 'goal', goalId) => this.broadcast({
        type: 'pod.updated',
        properties: { podId, kind, ...(goalId ? { goalId } : {}) },
      }),
      log: (message) => log.info(message),
    });
    this.podGoalService = new PodGoalService({
      store: this.podStore,
      pods: this.podService,
      startGoal: (goalId, projectDirHint) => this.startGoalDirect(goalId, projectDirHint),
      advanceGoal: (goalId) => this.goalDriver?.advance(goalId) ?? Promise.resolve(),
      resolveProjectDir: (goalId) => {
        const resolution = resolveGoalRefFromEntries(this.registeredGoalEntries(), goalId);
        return resolution.ok ? resolution.ref.projectDir : null;
      },
      now: () => new Date().toISOString(),
      newId: () => `podgoal_${randomUUID()}`,
      notify: (podId, kind = 'goal', goalId) => this.broadcast({
        type: 'pod.updated',
        properties: { podId, kind, ...(goalId ? { goalId } : {}) },
      }),
      budget: this.podBudget,
      revisions: this.podGoalRevisionService,
      worktrees: this.podWorktreeService,
      sessions: { retireRevision: (goalId, revision) => this.podSessionLifecycle.retireRevision(goalId, revision) },
      // 打回需要立刻恢复 Tech Lead 讨论、并把反馈记进方向输入：这两者在本函数稍后
      // 才构造，因此用惰性适配器（调用时才解析到真实服务）。
      techLead: { ensureSession: (goalId) => this.podTechLeadService.ensureSession(goalId) },
      directions: { recordRejectInput: (input) => this.podDirectionService.recordRejectInput(input) },
      goalState: (goalId) => {
        const found = this.findGoalStatePath(goalId);
        if (!found) return null;
        const state = loadGoalState(found.info.mafwDir, goalId);
        return state ? {
          terminal: isTerminalState(state),
          verdict: goalVerdictFromState(state) ?? undefined,
        } : null;
      },
      describeGoal: (goalId) => this.describePodGoal(goalId),
      resultForGoal: (goalId) => this.readPodGoalResult(goalId),
      listInFlightGoals: (projectDir) => this.listGoalStates()
        .filter((entry) => canonicalProjectDir(entry.projectDir) === projectDir)
        .map((entry) => loadGoalState(entry.mafwDir, entry.goalId))
        .filter((state): state is NonNullable<typeof state> => !!state && !isTerminalState(state))
        .map((state) => state.goalId),
      listRegisteredProjectDirs: () => Array.from(this.registeredProjects.keys()),
      finalizeGoal: (goalId, outcome) => this.finishPodGoal(goalId, outcome as any),
      log: (message) => log.info(message),
    });

    this.podSessionSupervisor = new PodSessionSupervisor({
      store: this.podStore,
      now: () => new Date().toISOString(),
      newId: () => `podsess_${randomUUID()}`,
      runtimeName: () => this.runtimeName,
      isAlive: async (sessionId) => {
        // Throwing is fail-open (treated alive) inside the supervisor; only an
        // explicit false retires and rebuilds the lease. The result must be a
        // real session record — an SDK error envelope for a foreign/deleted id
        // is not alive.
        const info = await this.runtime!.session.get({ sessionID: sessionId });
        return isLiveSessionInfo(info);
      },
      dispose: async (sessionId) => {
        try {
          await this.runtime!.session.delete({ sessionID: sessionId });
        } catch { /* best effort: lease row was never written */ }
      },
      broadcast: (event) => this.broadcast(event as any),
      log: (message) => log.info(message),
      // Phase C Task 6: observe-only mirror into the unified session registry.
      sessionRegistry: this.sessionRegistry,
    });
    this.podSessionLifecycle = new PodSessionLifecycle({
      store: this.podStore,
      supervisor: this.podSessionSupervisor,
      runtimeName: () => this.runtimeName,
      snapshotSession: (sessionId) => this.podService.snapshotSession(sessionId),
      log: (message) => log.info(message),
    });
    this.podDirectionService = new PodDirectionService({
      store: this.podStore,
      resolveMafwDir: (goalId) => this.findGoalMafwDir(goalId),
      now: () => new Date().toISOString(),
      newId: () => `dirreq_${randomUUID()}`,
      notify: (podId) => this.broadcast({ type: 'pod.updated', properties: { podId, kind: 'direction' } }),
      log: (message) => log.info(message),
    });
    const leadTopics = new LeadTopicStore(this.getGatewayDb().getStore());
    const leadTopicIndex = new TopicMessageIndexStore(this.getGatewayDb().getStore());
    const leadTopicSummary = new LeadTopicSummaryService({
      topics: leadTopics,
      index: leadTopicIndex,
      summarize: summarizeTopic,
      now: () => new Date().toISOString(),
      log: (message) => log.warn(message),
    });
    this.leadTopics = leadTopics;
    this.leadTopicIndex = leadTopicIndex;
    this.leadTopicSummary = leadTopicSummary;
    const leadHandoffService = process.env.MAFW_LEAD_HANDOFF === '0'
      ? null
      : new LeadHandoffService({
          topics: leadTopics,
          listMessages: async ({ sessionID, limit }) => {
            const page: any = await this.runtime!.session.messages({ sessionID, limit });
            return { data: page?.data ?? [] };
          },
          now: () => new Date().toISOString(),
          newId: () => `topic_${randomUUID()}`,
          log: (message) => log.warn(message),
          onCommitted: (prepared) => leadTopicSummary.indexAndSummarize(prepared),
        });
    this.podTechLeadService = new PodTechLeadService({
      store: this.podStore,
      pods: this.podService,
      sessions: this.podSessionSupervisor,
      runtimeName: () => this.runtimeName,
      worktrees: this.podWorktreeService,
      leadHandoff: leadHandoffService ?? undefined,
      runtime: createTechLeadRuntimeAdapter({
        createSession: async ({ projectDir }) => {
          const created = await this.runtime!.session.create({ directory: projectDir });
          return created;
        },
        // P0-4：v2 会话模型与 agent 解耦，建会话后显式绑模型（config.goal.techLeadModel
        // 覆盖优先、身份内置兜底）。lazy 读 runtime：本闭包在 runtime 建好之前构造。
        switchModel: (opts) => {
          const fn = this.runtime?.session.switchModel;
          return fn ? (fn as any).call(this.runtime!.session, opts) : Promise.resolve();
        },
        promptAsync: (opts) => this.runtime!.session.promptAsync(opts as any),
        messages: async ({ sessionID, limit }) => {
          const page: any = await this.runtime!.session.messages({ sessionID, limit });
          return { data: page?.data ?? [], nextCursor: page?.nextCursor };
        },
        identityModel: this.identityRegistry?.get(TECH_LEAD_AGENT)?.model,
        // I-1：现读 getter —— config.reload() 会整体替换 this.data，构造期快照会吞掉
        // 运行时通过 /api/model-config 或 config.yaml 的修改；热更对下一个新会话生效。
        configModel: () => (config.raw as any)?.goal?.techLeadModel,
      }),
      resolveProject: (requested) => {
        const canonical = canonicalProjectDir(requested || this.resolvedProjectDir());
        const hit = Array.from(this.registeredProjects.entries())
          .find(([dir]) => canonicalProjectDir(dir) === canonical);
        return hit ? { projectDir: hit[0], mafwDir: hit[1].mafwDir } : null;
      },
      now: () => new Date().toISOString(),
      newId: () => `podgoal_${randomUUID()}`,
      newGoalId: () => makePodGoalId(new Date().toISOString(), Math.random),
      registerInternalSession: (sessionId, role, identity) => {
        this.registerInternalSession(sessionId, role, identity);
      },
      emitGoalCreated: (event) => eventBus.emit('goal_created', event as any),
      notify: (podId, kind = 'goal') => this.broadcast({ type: 'pod.updated', properties: { podId, kind } }),
      log: (message) => log.info(message),
    });
    // Task 17：Lead 的上下文选择 + 每个节点/探针 prompt 的确定性 ContextManifest。
    this.podContextSelectionService = new PodContextSelectionService({
      store: this.podStore,
      runtimeName: () => this.runtimeName,
      resolveMafwDir: (goalId) => this.findGoalMafwDir(goalId),
      now: () => new Date().toISOString(),
      log: (message) => log.info(message),
    });

    this.podMessageDelivery = new PodMessageDelivery({
      store: this.podStore,
      runtimeName: () => this.runtimeName,
      promptAsync: async (input) => {
        await this.runtime!.session.promptAsync({
          sessionID: input.sessionID,
          parts: [{ type: 'text', text: input.message }],
          delivery: input.delivery,
        });
      },
      now: () => new Date().toISOString(),
      notify: (podId) => this.broadcast({ type: 'pod.updated', properties: { podId, kind: 'message' } }),
      log: (message) => log.info(message),
    });
    this.podA2ABridge = new PodA2ABridge({
      store: this.podStore,
      access: this.podAccess,
      delivery: this.podMessageDelivery,
      describeArtifact: (podId, ref) => {
        try {
          if (!this.podStore.getPod(podId)) return null;
          return new PodA2AArtifactStore(() => this.podArtifactRoots(podId)).describe(ref);
        } catch {
          return null;
        }
      },
      now: () => new Date().toISOString(),
      newId: () => `poda2a_${randomUUID()}`,
      notify: (podId) => this.broadcast({ type: 'pod.updated', properties: { podId, kind: 'message' } }),
      log: (message) => log.info(message),
    });

    const lazyShell = () => {
      const shell = this.runtime?.shell;
      if (!shell) throw new TaskError(503, 'shell task API not available on this runtime');
      return shell;
    };
    this.taskService = new TaskService({
      storeDir: path.join(mafwDir, 'tasks'),
      shell: {
        create: (o) => lazyShell().create(o),
        get: (o) => lazyShell().get(o),
        output: (o) => lazyShell().output(o),
        remove: (o) => lazyShell().remove(o),
      },
      spawnSubagent: (o) => this.subagentService.spawn(o),
      cancelSubagent: (parentID, childID) => this.subagentService.cancel(parentID, childID),
      messageSubagent: (parentID, childID, text) => this.subagentService.message(parentID, childID, text),
      getSession: (sid) => this.runtime!.session.get({ sessionID: sid }),
      pendingInput: async (sessionID, directory) => {
        try {
          const qs = await (this.runtime?.session as any)?.question?.list?.(directory ? { directory } : undefined) ?? [];
          if (Array.isArray(qs) && qs.some((q: any) => q?.sessionID === sessionID)) return true;
          const ps = await (this.runtime?.session as any)?.permissionList?.(directory ? { directory } : undefined) ?? [];
          return Array.isArray(ps) && ps.some((p: any) => p?.sessionID === sessionID);
        } catch {
          return false;
        }
      },
      emit: (task) => {
        // 兼容期双发：task.updated 是 desktop 现有 task-store 的入口；background.job.updated
        // 是三源统一的中性视图（Task 11 迁移后台面板后 task.updated 面收窄）。
        this.broadcast({ type: 'task.updated', task, sessionID: task.parentSessionID });
        try {
          const job = jobFromTask(task);
          this.broadcast(mafwBroadcast({ type: MAFW.backgroundJobUpdated, properties: { job }, sessionID: job.sessionID }));
        } catch {
          // fail-open：旧事件已发出，新视图失败不阻断任务生命周期
        }
      },
    });
    this.backgroundJobs = new BackgroundJobService({
      tasks: this.taskService,
      registry: this.backgroundShells,
      // 权威子代理来源（SubagentService 状态机：running/completed/failed/aborted）
      listSubagents: (sessionID) => this.subagentService.list(sessionID),
      outputShell: async (opts) => {
        if (!this.runtime?.access.can('session.shell')) {
          throw new BackgroundJobError(503, 'runtime shell output is not available on this runtime');
        }
        return this.runtime!.shell!.output(opts);
      },
      cancelShell: async (opts) => {
        if (!this.runtime?.access.can('session.shell')) {
          throw new BackgroundJobError(503, 'runtime shell cancel is not available on this runtime');
        }
        await this.runtime!.shell!.remove(opts);
      },
      cancelSubagent: async ({ parentSessionID, childSessionID }) => {
        if (!this.runtime?.access.can('session.abort')) {
          throw new BackgroundJobError(503, 'subagent cancel is not available on this runtime');
        }
        // 归属校验（父会话必须拥有该子会话）由 SubagentService.cancel 负责 → 404
        await this.subagentService.cancel(parentSessionID, childSessionID);
      },
      broadcast: (job) => this.broadcast(mafwBroadcast({
        type: MAFW.backgroundJobUpdated,
        properties: { job },
        sessionID: job.sessionID,
      })),
    });
    this.memoryService = new MemoryService(mafwDir);

    // P1/P2: dense embedding runtime + consolidation. initEmbeddingServices is
    // re-entrant — /api/memory/embedding-config hot-swaps the engine without a
    // gateway restart. The write-path listener resolves the runtime lazily so
    // a swap never leaves a stale provider wired to writes.
    this.initEmbeddingServices(mafwDir);
    onMemoryWritten(u => {
      const rt = getEmbeddingRuntime();
      if (rt) {
        rt.indexer.onUnitWritten(u);
        rt.scheduleFlush();
      }
      this.consolidationService?.enqueue(u);
    });

    // V2 ①c: GLiNER entity augmentation (fire-and-forget, fail-open). Zero-
    // shot spans land in the index entry's cue_anchors (retrieval key
    // surface only — the OKF file is not rewritten).
    if (config.recall?.entityHarvest !== false && this.memoryService) {
      const { glinerAugmentListener } = require('./memory/gliner-engine');
      onMemoryWritten(glinerAugmentListener({ index: this.memoryService.harmonicIndex }));
    }

    // H1 audit: log every write-time MinHash merge to jsonl — the preemption
    // rate on the real distribution + hand-check surface for separate-class
    // wrong-merges (char-3gram similar but different entity). Static listener
    // catches all merge sites (file store, merge-memory handler, scripts).
    MinHashMerger.onMerge((e) => {
      try {
        const logsDir = path.join(mafwDir, 'logs');
        fs.mkdirSync(logsDir, { recursive: true });
        fs.appendFileSync(path.join(logsDir, 'minhash-merges.jsonl'), JSON.stringify(e) + '\n', 'utf-8');
      } catch { /* fail-open */ }
    });

    // S1: wire write-time routing (embedding recall + LLM identity judge).
    // The judge store shares this.memoryService.harmonicIndex so UPDATE merges
    // land in the live index (fixing the consolidation index divergence).
    const routeRt = getEmbeddingRuntime();
    if (routeRt && this.memoryService) {
      const judgeStore = new HarmonicUnitFileStore(mafwDir, this.memoryService.harmonicIndex);
      const judgeModel = resolveJudgeModel(config.recall);
      const providerID = judgeModel?.providerID;
      const modelID = judgeModel?.modelID;
      const judgeBaseUrl = providerID ? resolveScanBaseUrl(providerID) : undefined;
      const judgeApiKey = judgeBaseUrl ? getProviderApiKey(providerID!) : null;
      setRouteWriteDeps({
        vectors: routeRt.vectors,
        provider: routeRt.provider,
        judge: async (u, ids) => {
          const v = await consolidationJudge(u, ids, {
            store: judgeStore,
            llm: judgeBaseUrl && judgeApiKey && modelID
              ? { baseUrl: judgeBaseUrl, apiKey: judgeApiKey, model: modelID }
              : undefined,
            completion: () => this.runtimeCompletionChannel(),
            model: providerID && modelID ? { providerID, modelID } : undefined,
          });
          if (!v) return null;
          return { action: v.action, targetId: v.target_id, distinction: v.distinction };
        },
        candidateCosine: config.memory.embedding.minCosine,
        dupCosine: config.memory.embedding.dupCosine,
        isSuperseded: (id) =>
          Boolean(this.memoryService!.harmonicIndex.getIndex().entries.find(e => e.id === id)?.superseded_by),
        // Near-identical skip check: a value change must route to the judge,
        // not be dropped as a duplicate.
        readEntry: (id) =>
          this.memoryService!.harmonicIndex.getIndex().entries.find(e => e.id === id),
        // G2 laya redundancy gate (write-phase): only wired when the sidecar is
        // provisioned (this.layaDeps undefined otherwise → gate skipped).
        // tauRedundantHigh 1.0 = observe-only (scores still flow to onRoute).
        laya: this.layaDeps
          ? { client: this.layaDeps.client as any, tauRedundantHigh: config.memory.embedding.laya?.tauRedundantHigh ?? 1.0 }
          : undefined,
        readUnit: async (id) => judgeStore.read(id),
        onRoute: (record) => {
          try {
            const logsDir = path.join(mafwDir, 'logs');
            fs.mkdirSync(logsDir, { recursive: true });
            fs.appendFileSync(path.join(logsDir, 'consolidation-pairs.jsonl'), JSON.stringify(record) + '\n', 'utf-8');
          } catch { /* fail-open */ }
        },
      });
      log.info('[RouteWrite] write-time routing enabled');
    }

    this.mediaPluginLoader = new MediaPluginLoader(path.join(mafwDir, 'media-plugins'), {
      getApiKey: this.runtimeGetApiKey.bind(this),
    });
    await this.mediaPluginLoader.init();
    this.pluginHost?.bindMedia((entries) => this.mediaPluginLoader?.setPackageEntries(entries));
    this.pluginHost?.bindTts((entries) => this.ttsRegistry.setPackageEngines(entries.map(e => e.engine)));
    // TTS legacy 插件目录（~/.mafw/tts-plugins/）+ 包贡献接线
    this.ttsPluginLoader = new TtsPluginLoader(path.join(mafwDir, 'tts-plugins'), {
      onChanged: () => this.ttsRegistry.setLegacyEngines(this.ttsPluginLoader?.getEngines() ?? []),
    });
    await this.ttsPluginLoader.init();
    this.ttsRegistry.setLegacyEngines(this.ttsPluginLoader.getEngines());
    // 内置 pi 引擎登记（可被用户同名包/文件覆盖——resolveMediaPrompt 语义）
    this.mediaPluginLoader.registerBuiltinEngine('pi', ['image', 'video', 'audio']);

    this.mediaService = new MediaService({
      prompt: createPiPromptAdapter({
        getApiKey: this.runtimeGetApiKey.bind(this),
      }),
      config: () => config.raw.media,
      resolvePrompt: (kind, cfg) => {
        const engineName = cfg[kind]?.engine ?? cfg.engine ?? 'pi';
        return resolveMediaPrompt(engineName, kind, {
          engines: this.mediaPluginLoader?.getEngines() ?? new Map(),
          builtinPi: () => {
            // 会话承载的媒体分析由 surface media.session 选择（不再按 runtime 名
            // 分支）：声明该通道的 runtime 用 MediaRuntimeExecutor，其余落无状态补全。
            if (this.runtime?.access?.can('media.session')) {
              // runtime 热切换后 runtime 实例更换——旧 executor 持有 stale
              // runtime 引用，必须重建（dispose 尽力而为，不阻塞 prompt）。
              if (!this.mediaRuntimeExecutor || this.mediaRuntimeExecutorRt !== this.runtime) {
                void this.mediaRuntimeExecutor?.dispose().catch(() => {});
                this.mediaRuntimeExecutor = createMediaRuntimeExecutor(this.runtime, {
                  projectDir: this.resolvedProjectDir(),
                  getApiKey: this.runtimeGetApiKey.bind(this),
                  // 契约补全通道同样经 surface（不再读 capabilities.completionApi）；
                  // 通道本体由组合根注入（facade 不暴露 completion）。
                  access: this.runtime.access,
                  completionChannel: () => this.runtimeCompletionChannel(),
                });
                this.mediaRuntimeExecutorRt = this.runtime;
              }
              return this.mediaRuntimeExecutor.prompt;
            }
            return undefined;
          },
        });
      },
    });
    // Determine workspace name: if projectDir resolves to a 'gateway' subdirectory,
    // use the parent directory name as the workspace identifier.
    const resolvedProjectDir = path.resolve(projectDir);
    const workspaceName = path.basename(resolvedProjectDir) === 'gateway'
      ? path.basename(path.dirname(resolvedProjectDir))
      : path.basename(resolvedProjectDir);
    
    this.mediaAgent = new MediaAgent(this.mediaService, {
      baseUrl: `http://127.0.0.1:${config.server.apiPort}`,
      artifactPath: '/a2a/artifacts',
      storageDir: path.join(mafwDir, 'workspace', workspaceName),
      cancelHook: async () => {
        await this.mediaRuntimeExecutor?.cancelInflight();
      },
    });
    const self = this;
    this.ttsService = createTtsService({
      config: () => config.raw,
      getApiKey: this.runtimeGetApiKey.bind(this),
    });
    this.ttsRegistry.registerBuiltin(createMimoEngine({
      config: () => config.raw as any,
      getApiKey: this.runtimeGetApiKey.bind(this),
    }));
    this.ttsRegistry.registerBuiltin(createKokoroEngine({ modelsDir: path.join(mafwDir, 'models') }));
    // Kernel 解释器解析：env 覆盖 → ~/.mafw/pykernel（office 三件套标准 venv，由
    // gateway/scripts/setup-pykernel.mjs 创建）→ 旧 agent-vision-toolkit venv。
    const pykernelDefault = process.platform === 'win32'
      ? path.join(os.homedir(), '.mafw', 'pykernel', 'Scripts', 'python.exe')
      : path.join(os.homedir(), '.mafw', 'pykernel', 'bin', 'python');
    const legacyVision = process.platform === 'win32'
      ? path.join(os.homedir(), 'AppData', 'Local', 'agent-vision-toolkit', '.venv-pykernel', 'Scripts', 'python.exe')
      : path.join(os.homedir(), '.local', 'share', 'agent-vision-toolkit', '.venv-pykernel', 'bin', 'python');
    const pyBin = process.env.MAFW_PYTHON_BIN
      || (fs.existsSync(pykernelDefault) ? pykernelDefault : legacyVision);
    this.kernels = new SessionKernels(pyBin);
    const cost = new CostService();
    this.ledger = new SchedulerLedger(projectDir);
    this.automationEngine = new AutomationEngine(mafwDir);
    this.automationEngine.setLedger(this.ledger);
    // Pipeline heartbeat (arXiv:2609.05510): background pipelines fail silently
    // by default — record last-run/last-success/counts and flag stalled ones.
    {
      const db = this.getGatewayDb();
      this.heartbeat = new PipelineHeartbeat(
        {
          get: (name) => db.kvGet('pipeline-heartbeat', name),
          set: (name, record) => db.kvSet('pipeline-heartbeat', name, record),
        },
        { onWarn: (msg) => log.warn(msg) },
      );
      this.automationEngine.setHeartbeat(this.heartbeat);
      if (!this.heartbeatTimer) {
        this.heartbeatTimer = setInterval(() => this.heartbeat?.sweep(), 30 * 60 * 1000);
        this.heartbeatTimer.unref?.();
      }
      // 队列防楔死清扫（spec §5.1 v2 Q2）：busy 15min TTL + 队列项 24h TTL。
      if (!this.queueSweepTimer) {
        this.queueSweepTimer = setInterval(() => this.sweepBusyAndQueue(), 60_000);
        this.queueSweepTimer.unref?.();
      }
      // 统一会话 sweeper（Phase C Task 7）：回收过期 session 记录（worker
      // 24h TTL → per-record onEvict dispose pair；其余视图按各自生命周期）。
      // sweepBusyAndQueue 是活跃簿记（非进程表状态），保持自己的间隔——见
      // plan Key Ruling 7。
      if (!this.sessionSweepTimer) {
        this.sessionSweepTimer = setInterval(() => {
          const swept = this.sessionRegistry.sweep();
          if (swept > 0) log.info(`[SessionRegistry] swept ${swept} expired session record(s)`);
        }, 60_000);
        this.sessionSweepTimer.unref?.();
      }
    }
    // memory:decay must mutate the gateway's LIVE index instance — a throwaway
    // manager's v1→v2 migration would be clobbered by the live instance's next
    // save (the 2026-09 decay freeze). Same live-instance discipline for the
    // cognitive graph (memory:prune).
    this.automationEngine.setIndexManagerProvider(() => this.memoryService!.harmonicIndex);
    this.automationEngine.setGraphProvider(() => this.memoryService?.cognitiveGraph);
    // Unified scheduler submission: per-key skip + 30min watchdog + budget
    // admission for every action execution; user/LLM triggers run foreground.
    this.automationEngine.setScheduler(this.scheduler);
    ensureManagerRules(mafwDir);
    ensureMemoryPipelineRules(mafwDir);
    this.automationEngine.loadRules();

    // Mobile push: device store + push gateway for WS online tracking (spec: mobile-devices.json; migrate legacy devices.json)
    const oldDevicePath = path.join(config.resolvePath(), 'devices.json');
    const deviceStorePath = path.join(config.resolvePath(), 'mobile-devices.json');
    try {
      if (fs.existsSync(oldDevicePath) && !fs.existsSync(deviceStorePath)) {
        fs.renameSync(oldDevicePath, deviceStorePath);
      }
    } catch { /* ignore migration error */ }
    const deviceStore = new DeviceStore(deviceStorePath);
    this.pushGateway = new PushGateway(deviceStore);

    // Mobile pairing service — auto-detect reachable IP (Tailscale > LAN > first non-loopback).
    // `http://localhost` is useless for mobile (the phone would try to connect to itself).
    const apiToken = (config.raw as any)?.server?.apiToken || '';
    const envUrl = process.env.MAFW_MOBILE_TAILSCALE_URL;
    const tailscaleUrl = resolveMobileBaseUrl(
      envUrl,
      (config.raw as any)?.mobile?.tailscaleUrl,
      detectReachableHost(),
      this.apiPort,
    );
    this.pairingService = new PairingService({ apiToken, tailscaleUrl });

    // Mobile mDNS discovery (P1: zero-config LAN connectivity)
    const { MdnsAdvertiser } = require('./mobile/mdns-advertiser');
    this.mdnsAdvertiser = new MdnsAdvertiser();
    this.mdnsAdvertiser.start({ apiPort: this.apiPort, apiToken });

    this.registerMemoryPipelineActions();

    const desktopClient = DesktopClient.tryLoad();
    if (desktopClient) {
      log.info('[Scheduler] Desktop automation client connected');
    }

    const services = {
      memory: this.memoryService,
      searchArchive: (sid: string, anchors: string[], k: number) => this.getGatewayDb().searchArchive(sid, anchors, k),
      resolveT1: (tail: string, turnId: number) => this.getGatewayDb().findArchiveBySessionTail(tail, turnId),
      cost,
      automation: this.automationEngine,
      ledger: this.ledger,
      mafwDir,
      listProjects: () => Array.from(this.registeredProjects.entries()).map(([projectDir, info]) => ({ projectDir, mafwDir: info.mafwDir })),
      podTechLead: this.podTechLeadService,
      podDirection: this.podDirectionService,
      podContextSelect: this.podContextSelectionService,
      podGoalDirection: {
        techLead: this.podTechLeadService,
        direction: this.podDirectionService,
        startPlanning: (goalId: string) => this.startGoalDirect(goalId),
        ...(process.env.MAFW_GOAL_MODES === '0' ? {} : {
          setGoalMode: (goalId: string, mode: any) => this.podTechLeadService.setGoalMode(goalId, mode),
        }),
        log: (message: string) => log.info(message),
      },
      podGoalStatus: {
        listViews: (projectDir: string) => {
          const pod = this.podStore.getPodByProject(canonicalProjectDir(projectDir));
          return pod ? this.podGoalService.views(pod.id) : [];
        },
        attention: (projectDir: string) => {
          const pod = this.podStore.getPodByProject(canonicalProjectDir(projectDir));
          return pod ? this.podGoalService.attention(pod.id) : [];
        },
      },
      desktop: desktopClient || undefined,
      restartAgent: async () => {
        if (!this.runtime?.access?.can('process.restart')) {
          throw new Error(surfaceUnavailableMessage('process.restart'));
        }
        if (this.serveRecovering) throw new Error('Agent restart already in progress');
        await this.recoverServe();
        return { success: true, mode: 'owned-respawn' };
      },
    };

    const toolRegistry = createToolRegistry();
    this.mcpEndpoint = new McpSSEEndpoint(toolRegistry, services);
    this.mcpStreamableEndpoint = new McpStreamableEndpoint(toolRegistry, services);

    log.info("[Scheduler] Services initialized (Memory + Cost + MCP SSE/StreamableHTTP + Automation)");

    // Trajectory tracking (agent trajectory stats + desktop sidebar)
    try {
      const { TrajectoryStore } = require('./trajectory/trajectory-store');
      const { TrajectoryCollector } = require('./trajectory/collector');
      const trajStore = new TrajectoryStore(this.getGatewayDb(), projectDir);
      this.trajectoryStore = trajStore;
      const collector = new TrajectoryCollector(trajStore, this.getGatewayDb(), projectDir, () => config.trajectory.retentionDays);
      collector.setRoleFor((sid: string) => this.internalSessionRoles.get(sid) ?? null);
      this.trajectoryCollector = collector;
      const pruned = this.getGatewayDb().kvPruneOlderThan('internal-session', INTERNAL_SESSION_TTL_DAYS);
      if (pruned > 0) log.info(`[Scheduler] pruned ${pruned} stale internal-session kv entries (> ${INTERNAL_SESSION_TTL_DAYS}d)`);
      const restored = this.getGatewayDb().kvAll<{ role: string }>('internal-session');
      for (const { key: sid, value } of restored) {
        if (value?.role && !this.internalSessionRoles.has(sid)) {
          this.internalSessionRoles.set(sid, value.role);
        }
      }
      if (restored.length > 0) {
        log.info(`[Scheduler] Restored ${restored.length} internal session role(s) from kv_store`);
      }
      const { backfillProviderColumn } = require('./trajectory/backfill-provider');
      backfillProviderColumn(this.getGatewayDb());
      const { PluginLoader } = require('./usage/plugin-loader');
      const { createUsageStatsProvider } = require('./usage/plugin-context');
      const pluginsDir = path.join(os.homedir(), '.mafw', 'usage-plugins');
      const builtinPluginsDir = path.join(__dirname, 'usage', 'builtin-plugins');
      const disabledPlugins = Array.isArray(config.usage?.disabledPlugins) ? config.usage.disabledPlugins : [];
      const statsProvider = createUsageStatsProvider(trajStore);
      this.usageStatsProvider = statsProvider;
      const pluginLoader = new PluginLoader(pluginsDir, [], {
        getApiKey: this.runtimeGetApiKey.bind(this),
        builtinPluginsDir,
        disabledPlugins,
        usageStats: statsProvider,
        // inline provider key 兜底（auth.json 无条目的自建 provider，如 gateway）——
        // thunk 惰性求值，runtime 此时尚未初始化也不影响。
        resolveInlineApiKey: async (providerID: string) => {
          try {
            const cfg: any = await this.runtimeHost?.config.get();
            return readProviderApiKey(cfg, providerID);
          } catch { return null; }
        },
      });
      await pluginLoader.init();
      this.pluginLoader = pluginLoader;
      this.pluginHost?.bindUsage((entries) => pluginLoader.setPackageEntries(entries));
      const { UsagePoller } = require('./usage/usage-poller');
      this.usagePoller = new UsagePoller(trajStore, () => config.usage.limits, () => config.usage.budgets, pluginLoader);
      log.info('[Trajectory] store initialized');
    } catch (err: any) {
      log.warn(`[Trajectory] init failed (non-fatal): ${err.message}`);
    }

    // Anchor graph for multi-hop retrieval (SQLite-backed, write-path synced).
    //
    // Startup budget matters: MCP clients (OpenCode) make ~3 connect attempts in
    // ~2s at boot and then mark a remote server failed permanently. A full graph
    // rebuild here is expensive (minutes once the DB has hundreds of thousands
    // of edges), so it must not run on every boot while :3000 is still unbound.
    // The write path keeps both graphs current; rebuild only when the tables are
    // empty or explicitly forced (MAFW_REBUILD_GRAPHS=1).
    try {
      const { AnchorGraphStore } = require('./graph/anchor-graph-store');
      const anchorStore = new AnchorGraphStore(this.getGatewayDb());
      const index = this.memoryService?.harmonicIndex?.getIndex();
      const rawDb = (this.getGatewayDb() as any).db;
      const rowCount = (table: string): number => {
        try {
          return (rawDb.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
        } catch {
          return 0;
        }
      };
      const forceRebuild = process.env.MAFW_REBUILD_GRAPHS === '1';

      if (forceRebuild || rowCount('anchor_units') === 0) {
        anchorStore.rebuild(index ?? { entries: [] });
        log.info('[AnchorGraph] store initialized & rebuilt');
      } else {
        log.info(`[AnchorGraph] store reused (${rowCount('anchor_units')} units / ${rowCount('anchor_edges')} edges; set MAFW_REBUILD_GRAPHS=1 to rebuild)`);
      }
      this.anchorGraphStore = anchorStore;
      this.memoryService?.harmonicIndex?.setAnchorGraphStore(anchorStore);

      const { CoactivationGraphStore } = require('./graph/coactivation-store');
      const coactStore = new CoactivationGraphStore(this.getGatewayDb());
      if (forceRebuild || rowCount('coactivation_units') === 0) {
        coactStore.rebuild(index ?? { entries: [] });
        log.info('[Coactivation] store initialized & rebuilt');
      } else {
        log.info(`[Coactivation] store reused (${rowCount('coactivation_units')} units / ${rowCount('coactivation_edges')} edges)`);
      }
      this.coactivationGraphStore = coactStore;
      this.memoryService?.harmonicIndex?.setCoactivationGraphStore(coactStore);
      try { this.heartbeat?.record('coactivation-rebuild', { ok: true, counts: coactStore.stats() }); } catch { /* non-fatal */ }
    } catch (err: any) {
      log.warn(`[AnchorGraph] init failed (non-fatal): ${err.message}`);
    }

    const enableLegacy = process.env[config.env.enableLegacyMcp] === "true";
    if (enableLegacy) {
      log.info("[Scheduler] Legacy MCP mode enabled — spawning old MCP Server");
      const { spawn } = require("child_process");
      spawn("node", [path.join(__dirname, "./core/mcp-server.js")], {
        cwd: this.projectDir,
        stdio: "inherit",
      });
    }
  }

  private setupEventBus() {
    // v2：eventBus → 扁平广播的翻译收敛为注册表（flat-emit-registry.ts，
    // 发射侧不再硬编码 if 链）；特殊消费者保持独立订阅，与广播翻译正交。
    for (const [name, emit] of FLAT_EMITTERS) {
      eventBus.on(name, (data: any) => this.broadcast(emit(data)));
    }
    eventBus.on("goal_created", (data: any) => {
      if (shouldAutoStartGoalEvent(data)) setImmediate(() => void this.startGoal(data.goalId, data.projectDir));
    });
    eventBus.on("state_change", (data: any) => {
      // legacy /goal skill 链唤醒——driver.advance 幂等（在飞即短路）
      if (data?.goalId) setImmediate(() => void this.goalDriver?.advance(data.goalId));
    });
    eventBus.on("phase_transition", (data: any) => {
      this.getMilestonePush()?.onPhaseTransition(data);
    });
  }

  private async startServe() {
    // Serve 拉起原语在组合根 RuntimeHost 上（agentProcess.spawnServe；facade 不含
    // 进程原语）——gateway 只做 bookkeeping（serveInstance/owned/exit 退避），不硬编码 spawn 细节。
    const spawnServe = this.runtimeHost?.agentProcess?.spawnServe;
    if (!spawnServe) {
      log.warn('[Scheduler] active runtime does not own a server process — skipping serve spawn');
      return;
    }
    log.info('Starting OpenCode Serve sidecar...');
    try {
      // host/port 归 runtime 自定（serve 端口是实现细节）；sidecar 实际 URL
      // 由 runtime 吸收（getBaseUrl 跟随），gateway 只记 bookkeeping。
      const sidecar = await spawnServe({
        rootDir: this.ensureRuntimeRootDir(),
        onOutput: (chunk) => log.debug(`[Serve] ${chunk.trimEnd()}`),
        onExit: (code) => this.handleServeExit(code),
      });
      this.serveInstance = {
        url: sidecar.url,
        close: () => sidecar.close(),
      };
      this.serveOwned = true;
      log.info(`OpenCode Serve started at ${sidecar.url} (owned sidecar)`);
    } catch (err: any) {
      log.error(`Failed to start OpenCode Serve: ${err.message}`);
      throw err;
    }
  }

  // Serve crashed → restart with backoff, then resubscribe the event stream
  // (the SSE subscription lives on the serve process and dies with it). The
  // streak only decays after the serve stays healthy for serveStableMs, so a
  // flapping serve escalates to the slow backoff instead of hot-restarting.
  private handleServeExit(code: number | null) {
    if (!this.serveOwned || this.serveRecovering) return;
    // After a hot-switch to an in-process/external runtime, the (still owned)
    // opencode serve is no longer the active backend: its exit must NOT trigger
    // recovery — pi has no spawnServe, so the orchestrator would fall into the
    // supervisor's kill+spawn path and retry forever (killing whatever listens
    // on the serve port each cycle). A later switch back re-ensures via
    // ensureServeForBuiltinRuntime (probe → adopt or spawn).
    const host = this.runtimeHost;
    if (host?.external || !host?.agentProcess?.spawnServe) {
      this.serveOwned = false;
      log.info('[Scheduler] owned serve exited after runtime switch; recovery skipped (active runtime does not own serve)');
      return;
    }
    this.serveInstance = undefined;
    if (this.serveStableTimer) {
      clearTimeout(this.serveStableTimer);
      this.serveStableTimer = null;
    }
    this.serveExitStreak++;
    const delay = this.serveExitStreak <= this.serveFastRetries
      ? [0, 5_000, 15_000][this.serveExitStreak - 1] ?? 15_000
      : this.serveBackoffMs;
    log.warn(`[Scheduler] OpenCode Serve exited (code=${code}); restarting in ${delay}ms (streak=${this.serveExitStreak})`);
    if (this.serveRetryTimer) clearTimeout(this.serveRetryTimer);
    this.serveRetryTimer = setTimeout(() => void this.recoverServe(), delay);
  }

  // Pure orchestration: kill + respawn + re-subscribe events + start watchdog.
  // No backoff/retry — callers that need retry wrap this themselves.
  // Kill/spawn primitives live on the runtime contract (agentProcess.restart /
  // agentProcess.spawnServe via supervisor.ensureStarted); the gateway only
  // orchestrates and re-subscribes the event stream.
  private async restartAgentOrchestrated(): Promise<{ mode: string }> {
    const host = this.runtimeHost;
    if (host?.agentProcess?.spawnServe) {
      await host.agentProcess.restart();
      await this.serveSupervisor.ensureStarted();
    } else {
      await this.serveSupervisor.restart();
    }
    await this.subscribeToEvents();
    this.startServeWatchdog();
    return { mode: 'owned-respawn' };
  }

  // Shared recovery for owned (exit-event) and adopted (watchdog) paths.
  // Wraps restartAgentOrchestrated() with backoff/retry logic.
  private async recoverServe() {
    if (this.serveRecovering || !this.running) return;
    this.serveRecovering = true;
    try {
      log.info('[Scheduler] Recovering OpenCode Serve...');
      await this.restartAgentOrchestrated();
      log.info('[Scheduler] OpenCode Serve recovered');
      if (this.serveStableTimer) clearTimeout(this.serveStableTimer);
      this.serveStableTimer = setTimeout(() => {
        this.serveExitStreak = 0;
        this.serveStableTimer = null;
      }, this.serveStableMs);
    } catch (err: any) {
      log.warn(`[Scheduler] Serve recovery failed: ${err.message}; retrying in ${this.serveBackoffMs}ms`);
      this.serveExitStreak++;
      if (this.serveRetryTimer) clearTimeout(this.serveRetryTimer);
      this.serveRetryTimer = setTimeout(() => void this.recoverServe(), this.serveBackoffMs);
    } finally {
      this.serveRecovering = false;
    }
  }

  // Health-poll watchdog covers both adopted and owned serves. SDK
  // `createOpencodeServer` does not expose an exit callback, and even owned
  // sidecars can die silently (network stack torn down without process exit).
  // External runtimes: probe-only — never kill or respawn the external process.
  private startServeWatchdog() {
    if (this.serveWatchdogTimer) return;
    let failures = 0;
    this.serveWatchdogTimer = setInterval(async () => {
      if (!this.running || this.serveRecovering) return;
      if (await this.isServeHealthy()) {
        if (failures > 0 || this.serveExternalDownNotified) {
          log.info('[Scheduler] Serve back online');
        }
        this.serveExternalDownNotified = false;
        failures = 0;
        return;
      }
      failures++;
      log.warn(`[Scheduler] Serve unhealthy (${failures}/${this.serveWatchdogFailures})`);
      if (failures >= this.serveWatchdogFailures) {
        failures = 0;
        if (this.runtime?.external) {
          if (!this.serveExternalDownNotified) {
            this.serveExternalDownNotified = true;
            log.error('[Scheduler] External serve unreachable — the active runtime does not own the serve process, so it will NOT be respawned. Serve-dependent features (provider list, sessions, approvals) are degraded.');
          }
          try { await this.subscribeToEvents(); } catch (err: any) {
            log.warn(`[Scheduler] External event reconnect failed: ${err.message}`);
          }
          return;
        }
        // Drop the stale handle so /health stops claiming serveRunning:true.
        this.serveInstance = undefined;
        await this.recoverServe();
      }
    }, this.serveWatchdogIntervalMs);
    this.serveWatchdogTimer.unref();
  }

  private stopServeWatchdog() {
    if (this.serveWatchdogTimer) {
      clearInterval(this.serveWatchdogTimer);
      this.serveWatchdogTimer = null;
    }
  }

  private async listSessions(projectID: string | null): Promise<any[]> {
    // Sessions that are infrastructure, never shown in the desktop session
    // list: memory-system workers (index-scan / extract / reflect), Task-tool
    // subagent children, and (Pod collaboration loop) the Lead / Tech Lead
    // sessions. The merge + hidden filter lives in `selectVisibleSessions`
    // (core/session-visibility.ts) so it is unit-testable.
    const roleFor = (id: string) => this.internalSessionRoles.get(id);

    // Local session store first: it is the authority for `metadata.mafw.role`
    // (the Lead session's runtime `agent` only flips to 'lead' on its first
    // prompt), so the hidden filter must see it before merging.
    let localSessions: any[] = [];
    try {
      localSessions = (await this.sdkSession.list()) as any[];
    } catch { localSessions = []; }

    // Try SDK first (opencode server), fall back to local store
    const fromServe: any[] = [];
    if (this.runtime) {
      try {
        const result = await this.runtime.session.list(projectID ? { directory: projectID } : undefined);
        const sessions = Array.isArray(result) ? result : [];
        if (sessions && Array.isArray(sessions)) fromServe.push(...sessions);
      } catch {}
    }

    // Merge server-known sessions with the opencode database so sessions that
    // belong to this project but are hidden by serve's project resolution
    // (serve resolves the project to `global` and lists only those) still show
    // up. The serve shape omits parentID, so the database window seeds the
    // child-session set.
    let dbSessions: any[] = [];
    try {
      if (projectID && this.runtime) {
        if (this.runtimeCaps.sessionStorageApi && this.runtime.session.listByDirectory) {
          // Effectively unbounded window: memory-worker sessions (index-scan
          // retries etc.) flood the recent head of the table, so any small
          // window filters down to almost nothing. Read the whole project and
          // let the client cap what it renders.
          dbSessions = await this.runtime.session.listByDirectory(projectID, 20000);
        } else {
          const all = await this.runtime.session.list();
          const target = normalizeDir(projectID);
          dbSessions = (Array.isArray(all) ? all : []).filter((s: any) => {
            const d = normalizeDir(s.directory || '');
            return d === target || d.startsWith(target + '/');
          });
        }
      }
    } catch {}

    return selectVisibleSessions({ fromServe, dbSessions, localSessions, projectID, roleFor });
  }

  private async isServeHealthy(): Promise<boolean> {
    // 健康唯一真相源 = runtime 契约 healthCheck()（serve 型探测 serve，
    // 进程内 runtime 探测自身引擎）；gateway 不自带 HTTP 探测。
    try {
      return (await this.runtimeHost?.healthCheck?.()) ?? false;
    } catch {
      return false;
    }
  }

  private async waitForServeReady(): Promise<void> {
    const maxRetries = config.timeouts.serveReadyMaxRetries;
    const interval = config.timeouts.serveHealthCheckInterval;
    for (let retries = 0; retries < maxRetries; retries++) {
      await this.sleep(interval);
      if (await this.isServeHealthy()) {
        log.info('[Scheduler] Serve is ready');
        return;
      }
    }
    throw new Error(`Failed to start OpenCode Serve after ${maxRetries * interval / 1000} seconds`);
  }

  /**
   * Lazy voice runtime: create/start the Qwen3-ASR sidecar only on the first
   * `/ws/voice` hello. A missing Python env must not break gateway startup.
   */
  private async getVoiceRuntime(): Promise<VoiceRuntime> {
    if (this.voiceRuntime) return this.voiceRuntime;
    if (Date.now() < this.voiceStartBlockedUntil) {
      throw new Error(this.voiceStartError || 'voice runtime is temporarily unavailable');
    }
    if (!this.voiceRuntimePromise) {
      this.voiceRuntimePromise = (async () => {
        this.voiceRuntimeConfig = resolveVoiceConfig(config.raw);
        if (!this.voiceSidecar) {
          this.voiceSidecar = new Qwen3AsrSidecar({
            port: this.voiceRuntimeConfig.sidecarPort,
            modelsDir: this.voiceRuntimeConfig.modelsDir,
          });
        }
        await this.voiceSidecar.start();
        if (!this.voiceAsrRegistry.list().some((e) => e.name === 'qwen3-asr-vllm')) {
          this.voiceAsrRegistry.register(new Qwen3AsrEngine({ sidecar: this.voiceSidecar }));
        }
        this.voiceRuntime = new VoiceRuntime({
          registry: this.voiceAsrRegistry,
          config: this.voiceRuntimeConfig,
          createAsr: async (name) => this.voiceAsrRegistry.resolve(name),
        });
        this.voiceStartBlockedUntil = 0;
        this.voiceStartError = '';
        return this.voiceRuntime;
      })().catch((err: any) => {
        const message = err?.message || String(err);
        // A broken Python env must not spawn a 180 s sidecar per client.
        this.voiceStartBlockedUntil = Date.now() + 15_000;
        this.voiceStartError = message;
        log.warn(`[Voice] runtime start failed: ${message}`);
        throw err;
      }).finally(() => {
        this.voiceRuntimePromise = undefined;
      });
    }
    return this.voiceRuntimePromise;
  }

  // 鈹€鈹€ 2. HTTP API 鈹€鈹€

  private async startApiServer(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      // P5 Wave 1: catalog shadow 登记 + 模块 handler 绑定（一次性，重复 attach 会抛错）。
      // adapter 显式桥接私有成员（结构化类型不认 private）。
      // runtime/runtimeCaps 必须是 getter（活引用）：attach 发生在 startApiServer，
      // 早于 runtime 初始化（441 行）与热切换重赋值——字面量快照会让 session.fork 等
      // 路由永远拿到 null/旧 capabilities（P5 引入的回归，2026-09-17 修复）。
      const gwSelf = this;
      attachWave1Handlers(this.routeRegistry, {
        getGatewayDb: () => this.getGatewayDb(),
        get runtime() { return gwSelf.runtime; },
        automationEngine: this.automationEngine,
        ledger: this.ledger,
        rotateDeps: () => this.rotateDeps(),
        embeddingConfigDeps: () => this.embeddingConfigDeps(),
        modelConfigDeps: () => this.modelConfigDeps(),
        usagePluginsDeps: () => this.usagePluginsDeps(),
        pluginLoader: this.pluginLoader,
        mediaPluginLoader: this.mediaPluginLoader,
        broadcast: (e) => this.broadcast(e),
        get taskService() { return gwSelf.taskService; },
        get sessionConfig() { return gwSelf.sessionConfigService; },
        get checkpointService() { return gwSelf.checkpointService; },
        get podService() { return gwSelf.podService; },
        get runCoordinator() { return gwSelf.runCoordinator; },
        get dataPartService() { return gwSelf.dataPartService; },
        get discovery() { return gwSelf.getDiscoveryService(); },
        isCheckpointBusy: (sid) => gwSelf.busySessions.has(sid),
        // switchAgent 双向门：coordination 槽位（LeadSessionRegistry 权威）与注册表身份。
        isCoordinationSession: (sid) => !!gwSelf.leadSessionRegistry?.findBySessionId(sid),
        isRegistryIdentity: (name) => !!gwSelf.identityRegistry?.get(name),
      });
      attachWave2Handlers(this.routeRegistry, {
        runtimeDeps: () => this.runtimeDeps(),
        restartAgentDeps: () => this.restartAgentDeps(),
        pluginHubDeps: () => this.pluginHubDeps(),
        pluginPackageDeps: () => this.pluginPackagesDeps(),
        pluginWebDeps: () => this.pluginWebDeps(),
        conformanceDeps: () => this.conformanceDeps(),
        dryEventDeps: () => this.dryEventDeps(),
        runtimeSwitchBlocked: () => this.serveRecovering || this.switchingRuntime,
        beginRuntimeSwitch: () => { this.switchingRuntime = true; },
        endRuntimeSwitch: () => { this.switchingRuntime = false; },
      });
      attachPodHandlers(this.routeRegistry, {
        pods: this.podService,
        tasks: this.podTaskService,
        messages: this.podMessageService,
        goals: this.podGoalService,
        memory: this.podMemoryService,
        access: this.podAccess,
        delivery: this.podMessageDelivery,
        intake: {
          create: (input) => createGoalIntake(input, {
            resolveProject: (requested) => {
              const canonical = canonicalProjectDir(requested || this.resolvedProjectDir());
              const hit = Array.from(this.registeredProjects.entries())
                .find(([dir]) => canonicalProjectDir(dir) === canonical);
              return hit ? { projectDir: hit[0], mafwDir: hit[1].mafwDir } : null;
            },
            now: () => new Date().toISOString(),
            emitGoalCreated: (event) => eventBus.emit('goal_created', event as any),
          }),
        },
        newGoalId: () => makePodGoalId(new Date().toISOString(), Math.random),
        // Task 18: POST /goals creates a direct discussion Goal via the Tech Lead.
        techLead: this.podTechLeadService,
        cost: async (podId) => this.podCost(podId),
        transcript: async (podId, sessionId) => this.podTranscript(podId, sessionId),
      }, {
        // Task 18: collaboration surface (Tech Lead discussion / direction / probes /
        // reject / revisions). Services are constructed above, so plain references.
        pods: this.podService,
        goals: this.podGoalService,
        techLead: this.podTechLeadService,
        directions: this.podDirectionService,
        probes: this.podProbeService,
        revisions: { list: (podId, goalId) => this.podStore.listGoalRevisions(podId, goalId) },
        revisionStatus: (podId, goalId, revision) => {
          const goal = this.podStore.getGoal(podId, goalId);
          if (!goal) return null;
          return this.podStore.getGoalRevision(podId, goalId, revision ?? goal.activeRevision)?.status ?? null;
        },
        startPlanning: (goalId) => this.startGoalDirect(goalId),
        access: this.podAccess,
      });

      attachPodA2ARoutes(this.routeRegistry, {
        getAgent: (podId) => this.podA2AAgent(podId),
      });
      // Task 3：中性 background jobs façade（三源统一；runtime shell 原生 DTO 不出 gateway）
      attachBackgroundJobHandlers(this.routeRegistry, () => ({ service: this.backgroundJobs ?? null }));
      // Phase D1 Task 2：认知面动词迁 registry dispatch（loopback-only 语义随迁）。
      attachCognitionRoutes(this.routeRegistry, { gate: () => this.cognitionGate });
      // Phase D1 Task 3a：Python 内核面迁 registry dispatch（loopback-only）。
      attachPythonRoutes(this.routeRegistry, { kernels: () => this.kernels });
      // Phase D1 Task 3b：MAFW 工具面迁 registry dispatch（loopback-only）。
      attachToolsRoutes(this.routeRegistry, {
        buildFactory: () => buildMafwToolFactory({ baseUrl: `http://127.0.0.1:${config.server.apiPort}` }),
        emitEvent: (evt) => this.handleRuntimeEvent(evt),
      });
      // Phase D1 Task 3c：TTS 面迁 registry dispatch（voices/speak 无 loopback
      // 门、stream/interrupt 有——legacy 语义逐字等价）。
      attachTtsRoutes(this.routeRegistry, {
        ttsRegistry: () => this.ttsRegistry,
        ttsReady: () => !!(this.ttsService && this.mediaAgent),
        putArtifact: (dataUrl) => this.mediaAgent!.putArtifact(dataUrl),
        inflight: this.ttsInflight,
      });
      // Phase D1 Task 3d：agent/terminal/mobile 面迁 registry dispatch。
      attachTerminalRoutes(this.routeRegistry, {
        getTerminalService: () => this.getTerminalService(),
        getAccess: () => this.runtime?.access ?? null,
      });
      attachAgentRoutes(this.routeRegistry, {
        listOutcomes: (() => this.getGatewayDb().listGoalOutcomes({ limit: 200 })) as any,
        getIndex: () => this.memoryService?.harmonicIndex.getIndex() ?? { entries: [] },
      });
      attachMobileRoutes(this.routeRegistry, {
        getMediaAgent: () => this.mediaAgent,
        apiToken: () => (config.raw as any)?.server?.apiToken || '',
        loadTtsArtifactHandler: async () => {
          const { createTtsArtifactHandler } = await import('./mobile/tts-artifact.js');
          return createTtsArtifactHandler({ agent: this.mediaAgent! });
        },
        loadMobileMediaHandler: async () => {
          const { createMobileMediaHandler } = await import('./mobile/media-proxy.js');
          return createMobileMediaHandler({
            agent: this.mediaAgent!,
            apiToken: (config.raw as any)?.server?.apiToken || '',
          });
        },
      });
      // Phase D1 Task 3e：媒体上传/分析面迁 registry dispatch（4 分支，
      // loopback 门 + 尺寸帽 + chunk 流逐字保留）。
      attachMediaRoutes(this.routeRegistry, {
        getMediaAgent: () => this.mediaAgent,
        getMediaService: () => this.mediaService,
      });
      // Phase D1 Task A1：project 面迁 registry dispatch（2 分支）。
      attachProjectRoutes(this.routeRegistry, {
        registeredProjects: () => this.registeredProjects,
        currentProjectDir: () => this.currentProjectDir,
        setCurrentProjectDir: (dir) => { this.currentProjectDir = dir; },
        db: () => this.getGatewayDb(),
      });
      // Phase D1 Task A2：mafw-commands 面迁 registry dispatch（2 分支；409 hold-queue 预检随迁）。
      attachMafwCommandRoutes(this.routeRegistry, {
        getRegistry: () => this.getMafwCommandRegistry(),
        registeredProjects: () => this.registeredProjects,
        projectDir: () => this.projectDir,
        shouldHoldQueue: (sessionID) => this.runCoordinator?.shouldHoldQueue(sessionID),
      });
      // Phase D1 Task A3：merge-memory 面迁 registry dispatch（1 分支；动态 import 保留）。
      attachMergeMemoryRoutes(this.routeRegistry, {
        memory: () => this.memoryService,
      });
      // Phase D1 Task A4：triage 面迁 registry dispatch（4 分支；confirm 不读 body 原样保留）。
      attachTriageRoutes(this.routeRegistry, {
        automationEngine: () => this.automationEngine,
        skillInstallDeps: () => this.skillInstallDeps(),
        mafwDir: () => this.mafwDir,
        ledger: () => this.ledger,
      });
      // Phase D1 Task A5：approvals 面迁 registry dispatch（4 分支；数据根扫描路径全保留）。
      attachApprovalsRoutes(this.routeRegistry, {
        registeredProjects: () => this.registeredProjects,
        allowlistStore: () => this.allowlistStore,
        permissionRules: () => this.permissionRules,
      });
      // Phase D1 Task B1：question / permission 面迁 registry dispatch（5 分支；
      // workspace 重试链与 capGuard 语义逐字保留）。
      attachQuestionsPermissionsRoutes(this.routeRegistry, {
        capGuard: (res, surface) => this.capGuard(res, surface),
        capGuardQuestion: (res) => this.capGuardQuestion(res),
        serveUrl: () => this.serveUrl,
        currentProjectDir: () => this.currentProjectDir,
        projectDir: () => this.projectDir,
        runtime: () => this.runtime,
        registeredProjects: () => this.registeredProjects,
        permissionRules: () => this.permissionRules,
      });
      // Phase D1 Task B2：usage 聚合面迁 registry dispatch（2 分支；fail-open 200 随迁）。
      attachUsageRoutes(this.routeRegistry, {
        trajectoryStore: () => this.trajectoryStore,
        usagePoller: () => this.usagePoller,
      });
      // Phase D1 Task B3/B4：recall 面迁 registry dispatch（instructions/pinned/priors/
      // context；裸 startsWith 收紧为精确段匹配，懒 require 全部保留）。
      attachRecallRoutes(this.routeRegistry, {
        buildInstructionBlocks: () => this.buildInstructionBlocks(),
        instructionSync: () => this.instructionSync ?? null,
        memoryService: () => this.memoryService,
        recallCalledBySession: () => this.recallCalledBySession,
        leadSessionRegistry: () => this.leadSessionRegistry,
        registeredProjects: () => this.registeredProjects,
        mafwDir: () => this.mafwDir,
        getGatewayDb: () => this.getGatewayDb(),
        getScanService: () => this.getScanService(),
      });
      // Phase D1 Task C1：automation 面迁 registry dispatch（6 分支；draft 静态段
      // 优先于 :id 由 registry 结构保证，legacy 注册序注释语义不变）。
      attachAutomationRoutes(this.routeRegistry, {
        automationEngine: () => this.automationEngine,
        ledger: () => this.ledger,
      });
      // Phase D1 Task C2：chat 面迁 registry dispatch（2 分支；enriched 保留
      // 自有 inline enrichment 副本，不并入 sendEnrichedInternal）。
      attachChatRoutes(this.routeRegistry, {
        registeredProjects: () => this.registeredProjects,
        projectDir: () => this.projectDir,
        runtime: () => this.runtime,
        shouldHoldQueue: (sessionID) => this.runCoordinator?.shouldHoldQueue(sessionID),
        memoryService: () => this.memoryService,
      });
      // Phase D1 Task C3：obs 捕获面迁 registry dispatch（手动 chunked reader、
      // 1MB 静默丢弃、fail-open 200 语义逐字保留）。
      attachObsRoutes(this.routeRegistry, {
        internalSessionRoles: () => this.internalSessionRoles,
        getGatewayDb: () => this.getGatewayDb(),
        getScanService: () => this.getScanService(),
        scheduleSnapshotRefresh: (sessionID) => this.scheduleSnapshotRefresh(sessionID),
      });
      // Phase D1 Task D1：sessions core 面迁 registry dispatch（10 分支；deleteLegacy
      // 与 session.delete 的 cleanup 集合不同，R4 各自逐字保留）。
      attachSessionsCoreRoutes(this.routeRegistry, {
        getGatewayDb: () => this.getGatewayDb(),
        resolvedProjectDir: () => this.resolvedProjectDir(),
        sdkSession: () => this.sdkSession,
        runtime: () => this.runtime,
        podService: () => this.podService,
        instructionSync: () => this.instructionSync,
        discovery: () => this.discovery,
        trajectoryStore: () => this.trajectoryStore,
        identityRegistry: () => this.identityRegistry,
        identityState: () => this.identityState,
        runCoordinator: () => this.runCoordinator,
        busySessions: () => this.busySessions,
        sessionQueue: () => this.sessionQueue,
        enqueueQueuedPrompt: (opts, source) => this.enqueueQueuedPrompt(opts, source),
        attachBudgetGuardForPrompt: (sessionID, maxTurns, maxCostUsd) => this.attachBudgetGuardForPrompt(sessionID, maxTurns, maxCostUsd),
        emitQueueUpdated: (sessionID, kind, items, itemId) => this.emitQueueUpdated(sessionID, kind, items, itemId),
      });
      // Phase D1 Task E1：sessions 读模型面迁 registry dispatch（5 分支；todo/trajectory/
      // token-summary/children 的 fail-open 200 语义逐字保留）。
      attachSessionsReadRoutes(this.routeRegistry, {
        runtime: () => this.runtime,
        trajectoryStore: () => this.trajectoryStore,
        projectDir: () => this.projectDir,
        listDataParts: (sessionID, messageIds) => this.getGatewayDb().listSessionDataParts(sessionID, { messageIds }),
        subagentService: () => this.subagentService,
      });
      // Phase D1 Task E2：sessions 审批 / 子代理面迁 registry dispatch（7 分支；
      // permission-mode GET/POST method 拆分与 subagents 五操作逐字委托）。
      attachSessionsPermissionsRoutes(this.routeRegistry, {
        approvalPolicy: () => this.approvalPolicy,
        runtime: () => this.runtime,
        permissionRules: () => this.permissionRules,
        subagentService: () => this.subagentService,
      });
      // Phase D1 Task F1：memory 查询/统计面迁 registry dispatch（9 分支；sticky 的
      // 503-空壳与 fail-open 200、stats 的 10s fok 缓存直写逐字保留）。
      attachMemoryRoutes(this.routeRegistry, {
        memoryService: () => this.memoryService,
        consolidationService: () => this.consolidationService,
        heartbeat: () => this.heartbeat,
        coactivationGraphStore: () => this.coactivationGraphStore,
        fokStatsCache: () => this.fokStatsCache,
        setFokStatsCache: (value) => { this.fokStatsCache = value; },
        mafwDir: () => this.mafwDir,
        getGatewayDb: () => this.getGatewayDb(),
        backfillEmbeddings: (limit) => this.backfillEmbeddings(limit),
      });
      // Phase D1 Task F2：goals inline 面迁 registry dispatch（6 分支 → 7 op；plan /
      // plan-approval 仍以原始 req.url 交给 handleGoalPlan 内部分流）。
      attachGoalRoutes(this.routeRegistry, {
        mafwDir: () => this.mafwDir,
        goalDriver: () => this.goalDriver,
        goalDriverMafwDirCache: () => this.goalDriverMafwDirCache,
        findGoalStatePath: (goalId) => this.findGoalStatePath(goalId),
        loadRequest: (goalId) => this.loadRequest(goalId),
        getGatewayDb: () => this.getGatewayDb(),
        handleValidate: (goalId, data) => this.handleValidate(goalId, data),
        handleComplete: (goalId, data) => this.handleComplete(goalId, data),
      });
      // Phase D1 Task G：dashboard 影子条（goals.list / dashboard.stats /
      // memory.add / memory.setSticky）挂 registry dispatch；handleDashboardAPI
      // 与联合分支整体保留（R5），四个精确 (method, path) 由 registry 先行接管。
      attachDashboardRoutes(this.routeRegistry, {
        activeGoals: () => this.activeGoals,
        registeredProjectsSize: () => this.registeredProjects.size,
        sseClientsSize: () => this.sseClients.size,
        serveRunning: () => this.serveRunning,
        trajectoryStore: () => this.trajectoryStore,
        memoryService: () => this.memoryService,
      });
      // Phase D1 Task H1：long-tail singles 迁 registry dispatch（voice/presence/
      // eval/orchestration/provider/agents + config GET/PUT + llm/compress +
      // media plugins 对；私有 handleCompress 经 compress 依赖桥接）。
      attachMiscRoutes(this.routeRegistry, {
        voiceRuntime: () => this.voiceRuntime,
        buildPresence: () => this.buildPresence(),
        runtime: () => this.runtime,
        resolvedProjectDir: () => this.resolvedProjectDir(),
        getGatewayDb: () => this.getGatewayDb(),
        capGuard: (res, surface) => this.capGuard(res, surface),
        identityRegistry: () => this.identityRegistry,
        identityState: () => this.identityState,
        runtimeName: () => this.runtimeName,
      });
      attachConfigRoutes(this.routeRegistry);
      attachLlmRoutes(this.routeRegistry, {
        compress: (observations, model) => this.handleCompress(observations, model),
      });
      attachMediaPluginRoutes(this.routeRegistry, {
        mediaPluginLoader: () => this.mediaPluginLoader,
      });
      // Phase D1 Task H2：devices / mobile 配对 / pods events / mcp 管理 / manager
      // session / events SSE 迁 registry dispatch（15 条 legacy 分支；handler 体逐字，
      // live getter 注入 pushGateway / pairingService / runtime / podEventService）。
      attachDevicesMobileRoutes(this.routeRegistry, {
        pushGateway: () => this.pushGateway,
        pairingService: () => this.pairingService,
      });
      attachPodsEventsRoutes(this.routeRegistry, {
        podEventService: () => this.podEventService,
      });
      attachMcpMgmtRoutes(this.routeRegistry, {
        runtime: () => this.runtime,
      });
      attachManagerSessionRoutes(this.routeRegistry, {
        leadSessionRegistry: () => this.leadSessionRegistry,
        getGatewayDb: () => this.getGatewayDb(),
      });
      attachEventsSseRoutes(this.routeRegistry, {
        chatSessions: () => this.chatSessions,
        eventStore: () => this.eventStore,
        sseClients: () => this.sseClients,
      });
      // code-first P0 试点：schema 是响应事实源，handler 返回数据（不写 res）。
      attachTypedRoute(this.routeRegistry, {
        operationId: 'session.list',
        response: SessionListResponse,
        handler: async ({ url }) => ({
          sessions: projectSessions(await this.listSessions(url.searchParams.get('projectID'))),
        }),
      });

      const server = http.createServer(async (req, res) => {
        try {
          res.setHeader('Content-Type', 'application/json');

          // CORS headers for SSE
          res.setHeader("Access-Control-Allow-Origin", config.server.cors.origin);
          res.setHeader("Access-Control-Allow-Methods", config.server.cors.methods);
          res.setHeader("Access-Control-Allow-Headers", config.server.cors.headers);

          if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }

        // Loopback detection (delegated to core/auth.ts)
        const isLoopback = isLoopbackAddr(req.socket.remoteAddress || '');

        // API token auth: required for non-loopback connections when a token
        // is configured (MAFW_SERVER_API_TOKEN). Loopback connections bypass.
        const apiToken = (config.raw as any)?.server?.apiToken || '';
        if (!authorizeRequest({ remoteAddress: req.socket.remoteAddress || '', headers: req.headers as any, url: req.url, host: String(req.headers.host || '') }, apiToken)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'unauthorized' }));
          return;
        }

        // P5 Wave 1: registry dispatch —— attach 过 handler 的路由在 legacy 链之前
        // 统一接管（shadow 条目无 handler 自然落回内联链）。**必须在鉴权之后**（P0-1）：
        // goals.sessions 须先于 dashboard 兜底、embedding-config 须先于 /api/memory/*
        // 委托（AGENTS.md §6.5 顺序教训由 dispatch 位置一次性满足）。
        if (await dispatchAuthorized({ registry: this.routeRegistry, apiToken }, req, res)) return;

        // Plugin Web surfaces：registry 只支持精确段数，`ui/*` / `api/*` 的通配
        // 在这里匹配（必须早于 dashboard 委托与反代）。三个精确端点
        // （web-ticket / ui 基路径 / events）由上面的 registry dispatch 接管。
        if (await this.handlePluginWebWildcard(req, res)) return;

        // 文件级历史（loopback-only）：office 技能保存前快照 / 桌面 / 调试。
        if (await handleFileHistoryRoutes(req, res, {
          service: () => this.fileHistory ?? null,
          isLoopback,
          resolveDirectory: async (sid) => {
            try {
              const info: any = await this.runtime?.session.get({ sessionID: sid });
              return sessionDirectoryOf(info);
            } catch { return null; }
          },
        })) return;

        // POST /a2a — A2A JSON-RPC (standard protocol methods)
        if (req.url === "/a2a" && req.method === "POST") {
          if (!isLoopback) { res.writeHead(403); res.end(JSON.stringify({ error: 'forbidden' })); return; }
          try {
            if (!this.mediaAgent) { res.writeHead(503); res.end(JSON.stringify({ error: 'MediaAgent not initialized' })); return; }
            const rawBody = await readBody(req);
            let body: string | Record<string, unknown>;
            try { body = JSON.parse(rawBody); } catch { body = rawBody; }
            const headers: Record<string, string | undefined> = {};
            for (const key of Object.keys(req.headers)) headers[key] = String(req.headers[key] ?? '');
            const result = await this.mediaAgent.handleJsonRpc(body, headers);
            res.writeHead(result.status, result.headers);
            res.end(result.body);
          } catch (err: any) {
            log.error('[A2A] error:', err?.message || String(err));
            res.writeHead(500);
            res.end(JSON.stringify({ error: err?.message || String(err) }));
          }
          return;
        }

        // GET /.well-known/agent-card.json — A2A agent discovery
        if (req.url === '/.well-known/agent-card.json' && req.method === 'GET') {
          if (!isLoopback) { res.writeHead(403); res.end(JSON.stringify({ error: 'forbidden' })); return; }
          try {
            if (!this.mediaAgent) { res.writeHead(503); res.end(JSON.stringify({ error: 'MediaAgent not initialized' })); return; }
            res.setHeader('Content-Type', 'application/a2a+json');
            res.end(JSON.stringify(this.mediaAgent.agentCard));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err?.message || String(err) }));
          }
          return;
        }

        // GET /a2a/artifacts/<id> — task artifact download (spec §6.7 output reference)
        const artifactMatch = req.url?.match(/^\/a2a\/artifacts\/([^/]+)$/);
        if (artifactMatch && req.method === 'GET') {
          if (!isLoopback) { res.writeHead(403); res.end(JSON.stringify({ error: 'forbidden' })); return; }
          try {
            if (!this.mediaAgent) { res.writeHead(503); res.end(JSON.stringify({ error: 'MediaAgent not initialized' })); return; }
            const artifact = this.mediaAgent.getArtifact(artifactMatch[1]);
            if (!artifact) { res.writeHead(404); res.end(JSON.stringify({ error: 'artifact not found' })); return; }
            const b64 = artifact.dataUrl.split(',')[1] || '';
            res.setHeader('Content-Type', artifact.mediaType);
            res.end(Buffer.from(b64, 'base64'));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err?.message || String(err) }));
          }
          return;
        }

        // GET /api/media/resolve-task/:id — Phase D1 Task C4：已迁 registry dispatch
        // （loopback 门随迁，见 routes/media-upload.ts）。

        // GET /api/tts/voices — 当前引擎音色 + 能力（desktop picker）
        // GET /api/voice/status — voice config + registered ASR engines.
        // GET /api/voice/status — Phase D1 Task H1：已迁 registry dispatch。

        // /api/tts/voices + POST /api/tts + /api/tts/stream + /api/tts/interrupt
        // — Phase D1 Task 3c：已迁 registry dispatch（attachTtsRoutes；voices/speak
        // 无 loopback 门、stream/interrupt 有——语义逐字等价）。

        // POST /api/media/analyze-audio — Phase D1 Task 3e：已迁 registry dispatch。
        // POST /api/media/upload — Phase D1 Task 3e：已迁 registry dispatch。

        // POST /api/media/create-task — Phase D1 Task 3e：已迁 registry dispatch。

        // POST /api/media/upload-and-create — Phase D1 Task 3e：已迁 registry dispatch。

        // Mobile TTS artifact + media proxy — Phase D1 Task 3d：已迁 registry dispatch。

        // POST /api/tts/stream + POST /api/tts/interrupt — Phase D1 Task 3c：
        // 已迁 registry dispatch（attachTtsRoutes；loopback 门随迁）。

        // POST /api/python/execute + restart + status — Phase D1 Task 3a：
        // 已迁 registry dispatch（attachPythonRoutes；loopback 守卫随迁）。

        // GET /api/tools + POST /api/tools/execute — Phase D1 Task 3b：
        // 已迁 registry dispatch（attachToolsRoutes；loopback 守卫随迁）。

        // GET /api/python/status — kernel status for a session — Phase D1 Task 3a：
        // 已迁 registry dispatch。

        // MCP endpoints on /mcp — dual transport:
        //   POST with ?sessionId=... → legacy SSE message channel
        //   POST without sessionId   → stateless StreamableHTTP (MCP 2025-03-26)
        //   GET with mcp-protocol-version header → StreamableHTTP standalone
        //     stream request → 405 (we serve no standalone stream; the
        //     StreamableHTTP client treats 405 as expected and stays in
        //     JSON-response mode)
        //   GET without it → legacy SSE session establishment (old clients)
        if (req.url?.startsWith("/mcp") && req.method === "POST") {
          const isLegacySsePost = new URL(req.url, "http://localhost").searchParams.has("sessionId");
          try {
            if (isLegacySsePost) {
              await this.mcpEndpoint!.handleMessage(req, res);
            } else if (this.mcpStreamableEndpoint) {
              await this.mcpStreamableEndpoint.handleRequest(req, res);
            } else {
              res.writeHead(503);
              res.end(JSON.stringify({ error: "StreamableHTTP endpoint unavailable" }));
            }
          } catch (err: any) {
            log.error("[MCP Message] Error:", err.message);
            if (!res.headersSent) {
              res.writeHead(500);
              res.end(JSON.stringify({ error: err.message }));
            }
          }
          return;
        }

        if (req.url === "/mcp" && req.method === "GET") {
          if (req.headers["mcp-protocol-version"]) {
            // StreamableHTTP client asking for a standalone SSE stream — we
            // run stateless JSON mode only, so decline per spec.
            res.writeHead(405, { Allow: "POST" });
            res.end();
            return;
          }
          try {
            await this.mcpEndpoint!.handleSSE(req, res);
          } catch (err: any) {
            log.error("[MCP SSE] Error:", err.message);
            if (!res.headersSent) {
              res.writeHead(500);
              res.end(JSON.stringify({ error: err.message }));
            }
          }
          return;
        }

        // Dashboard SPA (HTML + assets)
        const isSPAAsset = req.url?.startsWith("/assets/") || req.url?.startsWith("/static/");
        if (req.url === "/" || isSPAAsset || req.url === "/index.html") {
          const publicDir = config.paths.dashboardPublic;
          if (req.url === "/" || req.url === "/index.html") {
            res.setHeader("Content-Type", "text/html");
            const indexPath = path.join(publicDir, "index.html");
            if (fs.existsSync(indexPath)) {
              res.end(fs.readFileSync(indexPath, "utf-8"));
            } else {
              res.writeHead(404);
              res.end("index.html not found");
            }
          } else {
            const assetPath = path.join(publicDir, req.url!.replace("/static/", ""));
            if (fs.existsSync(assetPath)) {
              const ext = path.extname(assetPath);
              const mime: Record<string, string> = { '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
              res.setHeader("Content-Type", mime[ext] || 'application/octet-stream');
              res.end(fs.readFileSync(assetPath));
            } else {
              res.writeHead(404);
              res.end("not found");
            }
          }
          return;
        }

        // Chat API + POST /api/chat/enriched — Phase D1 Task C2：已迁 registry dispatch。

        // POST /api/mafw-commands/run + GET /api/mafw-commands — Phase D1 Task A2：已迁 registry dispatch。
        // POST /api/merge-memory — Phase D1 Task A3：已迁 registry dispatch。

        // GET /api/memory/{merged-search,stats,sticky,get,search,energy-distribution} + POST /api/memory/embeddings/backfill
        // + DELETE /api/memory/{id} + GET /api/l5/axioms — Phase D1 Task F1：已迁 registry dispatch。
        // POST /api/goals/{goalId}/questions/{questionId}/respond — Phase D1 Task F2：已迁 registry dispatch。
        // GET /api/goals/:id/sessions — P5 Wave 1 起由 registry dispatch 接管
        // （历史约束"须挂 Dashboard /api/goals* 兜底之前"由 dispatch 位置满足）。

        // GET /api/goals/:id/source — registry route `goals.source` (handoff provenance + full text).
        // GET /api/goals/:id/timeline — Phase D1 Task F2：已迁 registry dispatch。
        // POST /api/goals/:id/nodes/:runId/retry — Phase D1 Task F2：已迁 registry dispatch。
        // GET /api/goals/:id/plan + POST /api/goals/:id/plan-approval — Phase D1 Task F2：已迁 registry dispatch。
        // GET /api/pods/:podId/events + POST .../events/:id/seen + POST .../events/seen
        // — Phase D1 Task H2：已迁 registry dispatch（pod.events.list / seen / seenAll）。

        // 跨项目常驻存在感（tray/taskbar 的唯一数据源）。
        // GET /api/presence — Phase D1 Task H1：已迁 registry dispatch。

        // POST /api/session/{id}/background — Phase D1 Task D1：已迁 registry dispatch。

        // Neutral terminal PTY façade — Phase D1 Task 3d：已迁 registry dispatch。

        // MCP 管理门面（runtime-neutral）+ MCP 配置写入（mcpConfigApi）
        // — Phase D1 Task H2：已迁 registry dispatch（mcp.servers / connect /
        // disconnect / configPreview / configPreviewRemove / configApply /
        // configRestore / configRemove；委派 handleMcp / handleMcpConfig 不变）。

        // Dashboard API
        if (req.url?.startsWith("/api/goals") || req.url?.startsWith("/api/stats") || req.url?.startsWith("/api/memory")) {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(await this.handleDashboardAPI(req)));
          return;
        }

        // POST /api/eval/chat/completions — EvalScope adapter: OpenAI-compatible
        // endpoint that drives a full main-agent run (media → agent → A2A →
        // MediaAgent → multimodal model) and returns the final answer.
        // POST /api/eval/chat/completions — Phase D1 Task H1：已迁 registry dispatch。

        // GET /api/config —gateway effective config
        // GET /api/config — Phase D1 Task H1：已迁 registry dispatch。

        // PUT /api/config — Phase D1 Task H1：已迁 registry dispatch。

        // 插件注册：必须传递 projectDir + mafwDir
        if (req.url === '/register' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', async () => {
            try {
              const data = JSON.parse(body);
              const intent = parseRegisterIntent(data);
              if (!intent) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Missing projectDir or mafwDir' }));
                return;
              }
              const { projectDir, mafwDir, setCurrent } = intent;

              // Never register the user's home directory (or its standard data
              // folders) as a project — desktop's opencode server plugin activates
              // with cwd=$HOME (or a folder under it) and would otherwise pollute
              // the registry with bogus "projects" (and manager sessions).
              if (this.isUserDataDir(projectDir)) {
                log.warn(`[Scheduler] Refusing to register user data directory as project: ${projectDir}`);
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'User data directory cannot be a project' }));
                return;
              }

              // 显式选择才允许切换当前项目；自动注册（插件激活）只登记。
              if (setCurrent && !isSelectableProject(projectDir, resolveRuntimeRoot())) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Infrastructure directory cannot be the current project' }));
                return;
              }

              const existing = this.registeredProjects.get(projectDir);
              const changed = !existing || existing.mafwDir !== mafwDir;
              this.registeredProjects.set(projectDir, {
                projectDir,
                mafwDir,
                registeredAt: existing?.registeredAt ?? new Date().toISOString()
              });

              if (setCurrent) {
                // 桌面 Rail 的"切换项目"（SDK project.setCurrent）。
                this.currentProjectDir = projectDir;
                this.getGatewayDb().kvSet('current-project', 'default', projectDir);
              }

              // 持久化到磁盘（写队列防并发覆盖）；无变化的自动注册不写盘/不广播，
              // 避免 hourly 插件注册把项目列表刷到 UI。
              if (changed || setCurrent) {
                await this.persistRegistry();
                // 桌面 renderer 依此事件刷新 Rail 项目列表（否则只在 gateway ready 时拉一次）。
                this.broadcast(projectRegisteredEvent(projectDir));
              }

              if (this.runtime) {
                try {
                  await this.ensureManagerSession(projectDir, mafwDir);
                } catch (err: any) {
                  log.warn(`[Scheduler] Manager session bootstrap failed: ${err.message} (non-fatal)`);
                }
              }

              log.info(`[Scheduler] Project registered: ${projectDir}`);
              res.writeHead(200);
              res.end(JSON.stringify({ status: 'ok', registered: projectDir }));
            } catch (err) {
              res.writeHead(400);
              res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
          });
          return;
        }

        // 控制指令（/control 为 MCP handler 兼容路径；/api/goals/control 为 SDK goals.control 契约路径，两者等价）
        if ((req.url === '/control' || req.url === '/api/goals/control') && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', async () => {
            try {
              const control = JSON.parse(body);
              log.info(`[Scheduler] HTTP control: ${control.action} ${control.goalId || ''}`);

              // 直接处理控制指令（同 processControlFile 逻辑）
              switch (control.action) {
                case 'PAUSE':
                  if (control.goalId) await this.patchState(control.goalId, { nextAction: 'PAUSED' });
                  break;
                case 'ABORT':
                  if (control.goalId) {
                    await this.destroyAllSessions(control.goalId);
                    // W1：取消语义 = 批准门也取消（防 terminal state 下 UI 残留 pending）
                    await this.patchState(control.goalId, { nextAction: 'FAILED', planApproval: null });
                    const state = this.activeGoals.get(control.goalId);
                    // Find projectDir for this goal
                    let projectDir: string | null = null;
                    for (const [pDir, info] of this.registeredProjects) {
                      if (fs.existsSync(path.join(info.mafwDir, 'state', `${control.goalId}.json`))) {
                        projectDir = pDir;
                        break;
                      }
                    }
                    if (projectDir) {
                      const { recordGoalOutcome } = await import('./orchestration/outcome-recorder.js');
                      recordGoalOutcome(this.getGatewayDb(), {
                        goalId: control.goalId,
                        verdict: 'CANCELLED',
                        rounds: state?.loop ?? 0,
                        lastError: 'User cancelled',
                        reviewFeedback: null,
                        projectDir,
                        mafwDir: path.join(projectDir, '.mafw'),
                        projectId: projectDir,
                      });
                    }
                    await this.archiveGoal(control.goalId, {
                      verdict: 'CANCELLED',
                      rounds: state?.loop ?? 0,
                      lastError: 'User cancelled',
                    });
                  }
                  break;
                case 'FORCE_PHASE':
                  if (control.goalId && control.targetPhase) {
                    await this.destroyAllSessions(control.goalId);
                    await this.patchState(control.goalId, {
                      nextAction: `CREATE_${control.targetPhase.toUpperCase()}_SESSION`
                    });
                  }
                  break;
                case 'RESET_PARAMETRIC':
                  log.info('[Scheduler] Resetting parametric cache...');
                  break;
              }

              res.writeHead(200);
              res.end(JSON.stringify({ status: 'ok' }));
            } catch (err) {
              res.writeHead(400);
              res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
          });
          return;
        }

        // POST /api/work/{goalId}/validate + POST /api/work/{goalId}/complete — Phase D1 Task F2：已迁 registry dispatch。
        // POST /api/manager/session/rotate — P5 Wave 1 起由 registry dispatch 接管
        // GET /api/manager/session — Phase D1 Task H2：已迁 registry dispatch
        // （manager.session；?projectDir= 单项目 / 全量投影语义随迁）。

        // 健康检查
        if (req.url === '/health' && req.method === 'GET') {
          res.writeHead(200);
          res.end(JSON.stringify({
            status: 'ok',
            serveRunning: !!this.serveInstance,
            registeredProjects: Array.from(this.registeredProjects.keys()),
            activeGoals: Array.from(this.activeGoals.keys()),
            media: { configured: !!this.mediaService?.isConfigured },
            ...(this.releaseMetadata && this.runtimeIdentity
              ? gatewayHealthFields(this.releaseMetadata, this.runtimeIdentity)
              : {}),
          }));
          return;
        }

        // GET /api/projects + GET /api/projects/current — Phase D1 Task A1：已迁 registry dispatch。

        // POST /api/devices + GET /api/devices + DELETE /api/devices/:id
        // — Phase D1 Task H2：已迁 registry dispatch（devices.register / list / delete）。
        // GET/DELETE /api/mobile/devices(:id) + POST /api/mobile/devices/register
        // + GET /api/mobile/pairing-code + POST /api/mobile/pairing/verify
        // — Phase D1 Task H2：已迁 registry dispatch（mobile.devicesList / devicesDelete /
        // devicesRegister / pairingCode / pairingVerify；配对令牌与 429 语义随迁）。
        // GET /api/approvals + POST /api/approvals/:id/respond — Phase D1 Task A5：已迁 registry dispatch。

        // GET /api/questions + POST /api/questions/:id/{reply,reject} — Phase D1 Task B1：已迁 registry dispatch。

        // 鈹€鈹€ Provider & Agents (composer model pill / @agent mention) 鈹€鈹€

        // ── /api/runtime routes — P5 Wave 2 起由 registry dispatch 接管
        // （runtimeDeps/restartAgentDeps 构造上移至私有方法；内联块对未知
        //   /api/runtime/* 悬空 return 吞请求的行为随之终结——现落回 legacy 链）

        // ── Plugin Hub (all four plugin types) — P5 Wave 2 起由 registry dispatch
        // 接管（pluginHubDeps 构造上移至私有方法；cleanupExamples 改为命中
        // /api/plugins 路由时才执行——内联时代每个到达此处的请求都跑）。

        // GET /api/orchestration/outcomes — goal outcome query
        // GET /api/orchestration/outcomes — Phase D1 Task H1：已迁 registry dispatch。

        // GET /api/provider – list providers + models (legacy /provider)
        // GET /api/provider — Phase D1 Task H1：已迁 registry dispatch。

        // GET /api/agents — Phase D1 Task H1：已迁 registry dispatch。

        // ── Runtime config (Settings page — runtime-neutral config surface) ──

        // GET /api/runtime-config — return the effective runtime Config
        if (matchRuntimeConfigRoute(req.url, 'GET') && req.method === 'GET') {
          if (this.capGuard(res, 'provider.config')) return;
          try {
            if (!this.runtime) { res.writeHead(503); res.end(JSON.stringify({ error: 'LLM client not available' })); return; }
            const configData = await this.runtimeHost?.config.get();
            res.end(JSON.stringify({ config: configData ?? {} }));
          } catch (err: any) {
            log.error('[OpenCodeConfig] get error:', err.message);
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // PATCH /api/runtime-config — merge-update the runtime Config (native merge semantics)
        if (matchRuntimeConfigRoute(req.url, 'PATCH') && req.method === 'PATCH') {
          if (this.capGuard(res, 'provider.config.update')) return;
          try {
            if (!this.runtime) { res.writeHead(503); res.end(JSON.stringify({ error: 'LLM client not available' })); return; }
            const body = JSON.parse(await readBody(req));
            const result = await this.runtimeHost?.config.update(body);
            res.end(JSON.stringify({ status: 'ok', config: result ?? null }));
          } catch (err: any) {
            log.error('[OpenCodeConfig] update error:', err.message);
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // GET|POST /api/sessions/{sid}/permission-mode — Phase D1 Task E2：已迁 registry dispatch。

        // /api/approvals/allowlist + /api/approvals/rules (GET/POST/DELETE) — Phase D1 Task A5：已迁 registry dispatch。

        // POST /api/permissions/{id}/reply — Phase D1 Task B1：已迁 registry dispatch。

        // GET /api/triage + POST /api/triage/:id/{confirm,reject,propose} — Phase D1 Task A4：已迁 registry dispatch。

        // ── Automation endpoints (Tier 4 — user only) ──
        // POST /api/automations/draft — Phase D1 Task C1：已迁 registry dispatch。
        // GET /api/automations — Phase D1 Task C1：已迁 registry dispatch。
        // GET /api/automations/:id — Phase D1 Task C1：已迁 registry dispatch。
        // PUT /api/automations/:id — Phase D1 Task C1：已迁 registry dispatch。
        // DELETE /api/automations/:id — Phase D1 Task C1：已迁 registry dispatch。
        // GET /api/automations/:id/history — Phase D1 Task C1：已迁 registry dispatch。

        // POST /api/llm/compress — LLM compression proxy (via SDK)
        // POST /api/llm/compress — Phase D1 Task H1：已迁 registry dispatch（handleCompress 经 compress 依赖桥接）。

        // 鈹€鈹€ SdkSessionResource REST endpoints 鈹€鈹€

        // POST /api/session — Phase D1 Task D1：已迁 registry dispatch。

        // POST /api/session/{id}/promptAsync — Phase D1 Task D1：已迁 registry dispatch。

        // POST /api/session/{id}/prompt — Phase D1 Task D1：已迁 registry dispatch。

        // DELETE /api/session/{id} — Phase D1 Task D1：已迁 registry dispatch。

        // POST /api/session/{id}/abort — Phase D1 Task D1：已迁 registry dispatch。

        // ── 认知面 HTTP 动词（spec 2026-10-22-cognition-gate-rewrite §5.4；loopback-only）──
        // Phase D1 Task 2：已迁 registry dispatch（attachCognitionRoutes；loopback
        // 守卫与 per-request config 读取随 handler 迁移，行为等价）。

        // ── 会话队列 inbox 管理面（spec 2026-10-22-session-queue-inbox §5.5）──
        // GET /api/session/{id}/queue — Phase D1 Task D1：已迁 registry dispatch。
        // DELETE /api/session/{id}/queue — Phase D1 Task D1：已迁 registry dispatch。
        // DELETE /api/session/{id}/queue/{itemId} — Phase D1 Task D1：已迁 registry dispatch。

        // DELETE/PATCH /api/sessions/:id — P5 Wave 1 起由 registry dispatch 接管

        // GET /api/sessions —— code-first P0 起由 registry typed handler 接管
        // （attachTypedRoute('session.list')，schema 见 routes/schemas/session.ts）。

        // POST /api/sessions/{id}/permissions/{requestId} — Phase D1 Task E2：已迁 registry dispatch
        // （always 持久规则沉淀与 permissionList 反查 fail-open 随迁）。

        // GET /api/sessions/{id} — Phase D1 Task D1：已迁 registry dispatch。

        // GET /api/sessions/{id}/messages — Phase D1 Task E1：已迁 registry dispatch。

        // GET /api/sessions/{id}/todo — Phase D1 Task E1：已迁 registry dispatch（fail-open 200 {data:[]}）。

        // GET /api/sessions/{id}/trajectory — Phase D1 Task E1：已迁 registry dispatch
        // （store 缺失 / 抛错 → fail-open 200 {turns:[],events:[]}；rebuild 懒 require 随迁）。

        // GET /api/sessions/{id}/token-summary — Phase D1 Task E1：已迁 registry dispatch
        // （store 缺失 / 抛错 → fail-open 200 零值汇总）。

        // /api/usage/plugins* — P5 Wave 1 起由 registry dispatch 接管（7 条）

        // GET /api/media/plugins — media engine plugin state list
        // GET /api/media/plugins — Phase D1 Task H1：已迁 registry dispatch。

        // POST /api/media/plugins/reload — Phase D1 Task H1：已迁 registry dispatch。

        // POST /api/media/switch — P5 Wave 1 起由 registry dispatch 接管

        // GET/POST /api/model-config — P5 Wave 1 起由 registry dispatch 接管

        // POST /api/sessions/:id/fork|revert|unrevert + /api/session/:id/summarize
        // — P5 Wave 1 起由 registry dispatch 接管

        // GET /api/usage + GET /api/usage/summary — Phase D1 Task B2：已迁 registry dispatch。

        // ── Subagent spawn/list/message/cancel/result — Phase D1 Task E2：已迁 registry dispatch。
        // （legacy 共享 matcher 的 GET/POST 双 method 臂由 catalog method 维度拆分。）

        // GET /api/sessions/{id}/children — Phase D1 Task E1：已迁 registry dispatch
        // （runtime 缺失 / 抛错 → fail-open 200 {items:[]}；depth 补齐随迁）。

        // GET /api/recall/context — Phase D1 Task B4：已迁 registry dispatch（逐字迁移，fail-open 200）。

        // GET /api/recall/{instructions,pinned,priors} — Phase D1 Task B3：已迁 registry dispatch。

        // GET /api/agent/capabilities — Phase D1 Task 3d：已迁 registry dispatch
        // （attachAgentRoutes；fail-open 语义随迁）。

        // POST /api/obs/capture — Phase D1 Task C3：已迁 registry dispatch
        // （手动 chunked reader / 1MB 静默丢弃 / fail-open 200 逐字随迁）。

        // POST /api/events — P5 Wave 1 起由 registry dispatch 接管

        // SSE 事件（→ Dashboard / Chat）— Phase D1 Task H2：已迁 registry dispatch
        // （event.subscribe；Mode A 全局流 + 持久回放 / Mode B chat session 订阅随迁）。

        // GET /health — standalone health endpoint (not proxied)
        if (req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
          return;
        }

        // Reverse proxy to the agent backend for non-MAFW routes —
        // target from the runtime contract (getBaseUrl), config 仅 bootstrap 兜底
        const serveUrl = this.runtimeHost?.getBaseUrl?.() ?? config.server.serveUrl;
        try {
          const proxyUrl = new URL(req.url || '/', serveUrl);
          const proxyReq = http.request(proxyUrl, {
            method: req.method,
            // 2.1.0：serve 强制 Basic——剔除入站 Authorization 后注入 serve 凭证
            headers: { ...injectServeAuth(req.headers, serveAuthHeaders()), host: proxyUrl.host },
          }, (proxyRes) => {
            res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
            proxyRes.pipe(res);
          });
          proxyReq.on('error', (err) => {
            res.writeHead(502);
            res.end(JSON.stringify({ error: 'Proxy error: ' + err.message }));
          });
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            req.pipe(proxyReq);
          } else {
            proxyReq.end();
          }
        } catch (err: any) {
          res.writeHead(502);
          res.end(JSON.stringify({ error: 'Proxy config error: ' + err.message }));
        }
      } catch (err: any) {
        log.error('[Scheduler] Unhandled request error:', err.message);
        if (!res.headersSent) {
          try { res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
          } catch { /* response already ended */ }
        }
      }
      });

      server.on('error', async (err: any) => {
        if (err.code === 'EADDRINUSE') {
          const alreadyRunning = await isPortHealthy(this.apiPort);
          await this.exitAfterPortConflict(alreadyRunning);
          return;
        }
        log.error(`[Scheduler] HTTP API error: ${err.message}`);
        resolve(false);
      });
      server.listen(this.apiPort, () => {
        log.info(`[Scheduler] HTTP API on port ${this.apiPort}`);
        log.info(`[Scheduler]  - POST /register  { projectDir, mafwDir }`);
        log.info(`[Scheduler]  - POST /control | /api/goals/control  { action, goalId, ... }`);
        log.info(`[Scheduler]  - GET  /health`);
        log.info(`[Scheduler]  - GET  /mcp           (MCP legacy SSE / StreamableHTTP 405)`);
        log.info(`[Scheduler]  - POST /mcp           (MCP StreamableHTTP stateless + legacy SSE messages)`);
        log.info(`[Scheduler]  - POST /api/llm/compress (LLM compression)`);
        log.info(`[Scheduler]  - POST /a2a            (A2A Media Agent JSON-RPC)`);
        log.info(`[Scheduler]  - GET  /.well-known/agent-card.json (A2A agent card)`);
        log.info(`[Scheduler]  - GET  /a2a/artifacts/:id (A2A artifact download)`);
        log.info(`[Scheduler]  - POST /api/tts        (MiMo-V2.5-TTS speech synthesis)`);
        log.info(`[Scheduler]  - POST /api/tts/stream (streaming TTS, SSE pcm16)`);
        log.info(`[Scheduler]  - POST /api/media/analyze-audio (structured audio understanding)`);
        log.info(`[Scheduler]  - GET  /api/tts/voices (TTS voices)`);
        log.info(`[Scheduler]  - WS   /api/ws        (mobile client events + send)`);
        log.info(`[Scheduler]  - GET/POST /api/terminal/sessions  (mafw-terminal/1; WS .../:id/connect?ticket=)`);
        log.info(`[Scheduler]  - GET  /              (Dashboard SPA)`);

        // WebSocket endpoint for mobile/remote clients: same event stream as
        // SSE (/api/events) plus an upstream `send` command.
        const wss = new WebSocketServer({ noServer: true });
        this.voiceWss = new WebSocketServer({ noServer: true });
        this.terminalWss = new WebSocketServer({ noServer: true });
        wss.on('connection', (ws) => {
          this.wsClients.add(ws);
          (ws as any).isAlive = true;
          (ws as any).missedPongs = 0;
          ws.on('pong', () => { (ws as any).isAlive = true; (ws as any).missedPongs = 0; });
          ws.send(JSON.stringify({ type: 'connected', timestamp: new Date().toISOString(), vocab: 'v2' }));
          ws.on('message', (raw) => {
            void this.handleWsMessage(ws, raw);
          });
          ws.on('close', () => {
            this.wsClients.delete(ws);
            const deviceId = (ws as any).deviceId;
            if (deviceId) this.pushGateway?.removeOnlineWs(deviceId);
          });
          ws.on('error', () => {
            this.wsClients.delete(ws);
            const deviceId = (ws as any).deviceId;
            if (deviceId) this.pushGateway?.removeOnlineWs(deviceId);
          });
        });

        // WS heartbeat: ping every 30s, prune dead connections after 2 missed pongs (60s).
        const wsPingInterval = setInterval(() => {
          for (const ws of this.wsClients) {
            if ((ws as any).isAlive === false) {
              (ws as any).missedPongs = ((ws as any).missedPongs || 0) + 1;
              if ((ws as any).missedPongs >= 2) {
                this.wsClients.delete(ws);
                const deviceId = (ws as any).deviceId;
                if (deviceId) this.pushGateway?.removeOnlineWs(deviceId);
                try { ws.terminate(); } catch { /* already closed */ }
                continue;
              }
            }
            (ws as any).isAlive = false;
            try { ws.ping(); } catch {
              this.wsClients.delete(ws);
              const deviceId = (ws as any).deviceId;
              if (deviceId) this.pushGateway?.removeOnlineWs(deviceId);
            }
          }
        }, 30_000);
        // Allow the process to exit without waiting for the ping timer.
        if (wsPingInterval.unref) wsPingInterval.unref();

        // Periodic PushGateway maintenance: sync lastSeen, prune stale online WS + expired device registrations.
        const deviceCleanupInterval = setInterval(() => {
          // 1. Remove WS entries with no activity for 2 minutes.
          this.pushGateway?.cleanupStale(120_000);
          // 2. Sync in-memory lastSeen to DeviceStore so active devices aren't pruned.
          //    This bridges the gap between WS heartbeat (updates in-memory only)
          //    and pruneDeviceStore (checks persisted lastSeen).
          this.pushGateway?.syncLastSeenToDeviceStore();
          // 3. Prune device-store entries not seen for 7 days (FCM token expiry hygiene).
          const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
          const pruned = this.pushGateway?.pruneDeviceStore(cutoff);
          if (pruned && pruned.length > 0) {
            log.info(`[PushGateway] pruned ${pruned.length} stale device(s) from store`);
          }
        }, 60_000);
        if (deviceCleanupInterval.unref) deviceCleanupInterval.unref();

        server.on('upgrade', (req, socket, head) => {
          const url = req.url || '';
          // Token auth on upgrade: delegated to core/auth.ts
          const rawAddr = (req.socket as any)?.remoteAddress || (socket as any).remoteAddress || '';
          const wsToken = (config.raw as any)?.server?.apiToken || '';

          if (isVoiceUpgradePath(url)) {
            if (!isLoopbackAddr(rawAddr)) {
              const wsAuth = authorizeWsUpgrade({ remoteAddress: rawAddr, headers: req.headers as any, url, host: String(req.headers.host || '') }, wsToken);
              if (!wsAuth.ok) {
                socket.write(wsAuth.rejectResponse!);
                socket.destroy();
                return;
              }
            }
            this.voiceWss!.handleUpgrade(req, socket, head, (ws) => {
              attachVoiceSocket(ws as any, {
                createSession: async () => (await this.getVoiceRuntime()).createSession(
                  (m) => ws.send(JSON.stringify(m)),
                ),
              });
            });
            return;
          }

          const terminalRequest = matchTerminalConnectUrl(url);
          if (terminalRequest) {
            // 中性终端 WS：loopback-only + 一次性 ticket（ticket 自带目录绑定）。
            if (!isLoopbackAddr(rawAddr)) {
              socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
              socket.destroy();
              return;
            }
            this.terminalWss!.handleUpgrade(req, socket, head, (ws) => {
              void this.getTerminalService()
                .bridge({ socket: ws as any, id: terminalRequest.id, ticket: terminalRequest.ticket })
                .catch(() => {
                  try { ws.close(4502, 'terminal bridge failed'); } catch { /* already closed */ }
                });
            });
            return;
          }

          const pluginWs = parsePluginWsUrl(url);
          if (pluginWs) {
            // 票据 cookie / loopback 鉴权在 handler 内完成；拒绝也消费 socket。
            handlePluginWsUpgrade(this.pluginWebDeps(), req, socket, head);
            return;
          }

          if (!url.startsWith('/api/ws')) {
            socket.destroy();
            return;
          }
          const wsAuth = authorizeWsUpgrade({ remoteAddress: rawAddr, headers: req.headers as any, url, host: String(req.headers.host || '') }, wsToken);
          if (!wsAuth.ok) {
            socket.write(wsAuth.rejectResponse!);
            socket.destroy();
            return;
          }
          wss.handleUpgrade(req, socket, head, (ws) => {
            // Extract deviceId from query string for PushGateway tracking
            try {
              const q = new URL(url, `http://${req.headers.host || 'localhost'}`);
              const deviceId = q.searchParams.get('deviceId');
              if (deviceId) {
                (ws as any).deviceId = deviceId;
                this.pushGateway?.addOnlineWs(deviceId, ws);
              }
            } catch { /* non-fatal */ }
            wss.emit('connection', ws, req);
          });
        });
        resolve(true);
      });
    });
  }

  /** Bind failed and another MAFW gateway owns the port: release our lease and defer. */
  private async exitAfterPortConflict(alreadyRunning: boolean): Promise<void> {
    await this.releaseInstanceOwnership();
    if (alreadyRunning) {
      process.stdout.write(`${JSON.stringify({
        mafw: 'deferred',
        instance: await this.readCurrentInstanceDiscovery(),
      })}\n`);
      log.info(`[Scheduler] Another gateway already running on port ${this.apiPort}; exiting`);
      process.exit(0);
      return;
    }
    log.error(`[Scheduler] Port ${this.apiPort} is occupied by another process; exiting`);
    process.exit(1);
  }

  private async readCurrentInstanceDiscovery() {
    try {
      return await readGatewayDiscovery(mafwRuntimeDir());
    } catch {
      return null;
    }
  }

  private async publishInstanceDiscovery(): Promise<void> {
    if (!this.releaseMetadata || !this.runtimeIdentity) return;
    const runtimeDir = mafwRuntimeDir();
    this.instanceDiscovery = await publishGatewayDiscovery({
      instanceId: this.runtimeIdentity.instanceId,
      pid: process.pid,
      port: this.apiPort,
      gatewayVersion: this.releaseMetadata.gatewayVersion,
      experienceVersion: this.releaseMetadata.experienceVersion,
      minimumClientExperienceVersion: this.releaseMetadata.minimumClientExperienceVersion,
      schemaEpoch: this.releaseMetadata.schemaEpoch,
      channel: this.runtimeIdentity.channel,
      distribution: this.runtimeIdentity.distribution,
      origin: process.env.MAFW_GATEWAY_ORIGIN?.trim() || 'standalone',
    }, runtimeDir);
    this.discoveryHeartbeatTimer = setInterval(() => {
      void this.instanceDiscovery?.heartbeat().catch((err: any) => {
        log.warn(`[Scheduler] gateway discovery heartbeat failed: ${err?.message ?? err}`);
      });
    }, 10_000);
    this.discoveryHeartbeatTimer.unref?.();
    log.info(`[Scheduler] gateway discovery published: ${gatewayDiscoveryPath(runtimeDir)} (port ${this.apiPort})`);
  }

  private async releaseInstanceOwnership(): Promise<void> {
    if (this.discoveryHeartbeatTimer) {
      clearInterval(this.discoveryHeartbeatTimer);
      this.discoveryHeartbeatTimer = null;
    }
    const discovery = this.instanceDiscovery;
    const lock = this.instanceLock;
    this.instanceDiscovery = null;
    this.instanceLock = null;
    try { await discovery?.release(); } catch { /* best effort */ }
    try { await lock?.release(); } catch { /* best effort */ }
  }

  // 鈹€鈹€ 3. 娉ㄥ唽琛ㄦ寔涔呭寲锛堝啓闃熷垪闃插苟鍙戯級 鈹€鈹€

  private async persistRegistry() {
    await this.registryWriteQueue.run('registry', async () => {
      const entries = Array.from(this.registeredProjects.entries());
      // Authoritative copy in the gateway DB (kv_store) — survives cwd /
      // projectDir churn because the db lives at the fixed ~/.mafw root.
      try {
        this.getGatewayDb().kvSet('registry/snapshot', 'default', entries);
      } catch (err: any) {
        log.warn(`[Scheduler] registry kv persist failed: ${err.message}`);
      }
      // Compatibility mirror at the legacy file location (opencode never
      // reads it; kept so older tooling can inspect registered projects).
      try {
        const dir = path.dirname(this.registryPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
          this.registryPath,
          JSON.stringify(entries, null, 2)
        );
      } catch (err: any) {
        log.warn(`[Scheduler] registry file persist failed: ${err.message}`);
      }
    });
  }

  // User data directories that must never be treated as projects (desktop's
  // opencode server plugin activates with cwd=$HOME or a folder under it).
  private userDataDirs(): Set<string> {
    const homeNorm = normalizeDir(os.homedir());
    const dirs = ['', 'Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos']
      .map(s => s ? `${homeNorm}/${s.toLowerCase()}` : homeNorm);
    return new Set(dirs);
  }

  private isUserDataDir(projectDir: string): boolean {
    return this.userDataDirs().has(normalizeDir(projectDir));
  }

  private async recoverRegistry() {
    // Authoritative source is the gateway DB snapshot (fixed ~/.mafw root);
    // fall back to the legacy file for first-run-after-upgrade recovery.
    let entries: [string, any][] | null = null;
    try {
      const snap = this.getGatewayDb().kvGet<[string, any][]>('registry/snapshot', 'default');
      if (Array.isArray(snap)) entries = snap;
    } catch (err: any) {
      log.warn(`[Scheduler] registry kv recover failed: ${err.message}`);
    }
    if (!entries && fs.existsSync(this.registryPath)) {
      try {
        entries = JSON.parse(fs.readFileSync(this.registryPath, 'utf-8')) as [string, any][];
      } catch (err: any) {
        log.error(`[Scheduler] Failed to recover registry: ${err.message}`);
      }
    }
    if (entries) {
      const filtered = entries.filter(([dir]) => !this.isUserDataDir(dir));
      this.registeredProjects = new Map(filtered);
      log.info(`[Scheduler] Recovered ${filtered.length} registered projects`);
    }
  }

  // ── 4. 轮询（降级兜底 + autoresume） ──

  private startBackupPolling() {
    const interval = config.timeouts.backupPollInterval;
    const poll = async () => {
      if (!this.running) return;
      try {
        await this.discoverNewGoals();
        // NodeDriver watchdog：in-flight 节点超时 → abort + 重试/归档（spec §6）。
        if (this.goalDriver) {
          const states = this.listGoalStates();
          for (const s of states) {
            this.goalDriverMafwDirCache.set(s.goalId, s.mafwDir);
            this.goalDriver.registerGoalDir(s.goalId, s.mafwDir);
          }
          await watchdogScan({
            driver: this.goalDriver, states,
            probeSession: this.runtimeCaps.sessionStorageApi
              ? async (sid) => {
                  try { const info = await this.runtime!.session.get({ sessionID: sid }); return info ? 'alive' : 'dead'; }
                  catch { return 'dead'; }
                }
              : undefined,
          });
        }
      } catch (err: any) {
        log.error('[Scheduler] Backup poll error:', err.message);
      }
      setTimeout(poll, interval);
    };
    setTimeout(poll, interval);
  }

  // 轮询已注册项目的 state/ 目录
  private async discoverNewGoals() {
    for (const [projectDir, info] of this.registeredProjects) {
      // 清理 stale entry（项目目录已删除）
      if (!fs.existsSync(info.mafwDir)) {
        log.warn(`[Scheduler] Project ${projectDir} no longer exists, removing from registry`);
        this.registeredProjects.delete(projectDir);
        await this.persistRegistry();
        continue;
      }

      const stateDir = path.join(info.mafwDir, 'state');
      if (!fs.existsSync(stateDir)) continue;

      const stateFiles = fs.readdirSync(stateDir).filter(f => f.endsWith('.json'));
      for (const file of stateFiles) {
        try {
          const statePath = path.join(stateDir, file);
          const state: StateFile = JSON.parse(fs.readFileSync(statePath, 'utf-8'));

          if (!this.activeGoals.has(state.goalId) &&
              state.nextAction !== 'COMPLETED' &&
              state.nextAction !== 'FAILED') {
            this.activeGoals.set(state.goalId, state);
            log.info(`[Scheduler] Discovered new goal ${state.goalId} at ${state.phase}`);
          } else if (this.activeGoals.has(state.goalId)) {
            // 更新缓存中的状态
            this.activeGoals.set(state.goalId, state);
          }
        } catch (err: any) {
          log.warn(`[Scheduler] Failed to read state ${file}: ${err.message}`);
        }
      }
    }
  }

  // 鈹€鈹€ 6. Archive 鈹€鈹€

  private async archiveGoal(goalId: string, outcome?: {
    verdict: 'PASS' | 'UNREVIEWED' | 'FAIL' | 'MAX_RETRIES' | 'ERROR' | 'CANCELLED';
    rounds: number;
    lastError?: string | null;
    reviewFeedback?: string | null;
  }) {
    log.info(`[Scheduler] Archiving goal ${goalId}`);
    await this.destroyAllSessions(goalId);

    let projectDir: string | null = null;
    for (const [pDir, info] of this.registeredProjects) {
      if (fs.existsSync(path.join(info.mafwDir, 'state', `${goalId}.json`))) {
        projectDir = pDir;
        break;
      }
    }

    if (projectDir) {
      try {
        const state = this.activeGoals.get(goalId);
        await archiveWorktree({ goalId, projectDir, loopCount: state?.loop || 1 });
      } catch (err: any) {
        log.error(`[Scheduler] Archive failed for ${goalId}: ${err.message}`);
        await this.destroyAllSessions(goalId);
        await this.patchState(goalId, {
          nextAction: 'FAILED',
          phase: 'ARCHIVED',
          error: 'archive_failed'
        });
        if (outcome) {
          const { recordGoalOutcome } = await import('./orchestration/outcome-recorder.js');
          recordGoalOutcome(this.getGatewayDb(), {
            goalId,
            verdict: outcome.verdict,
            rounds: outcome.rounds,
            lastError: `archive_failed: ${err.message}`,
            reviewFeedback: outcome.reviewFeedback,
            projectDir: projectDir!,
            mafwDir: path.join(projectDir!, '.mafw'),
            projectId: projectDir!,
          });
        }
        if (projectDir) this.getMilestonePush()?.onArchived(goalId, projectDir, outcome?.verdict ?? 'CANCELLED');
        await this.finishPodGoal(goalId, outcome);
        return;
      }
    }

    await this.patchState(goalId, {
      nextAction: 'COMPLETED',
      phase: 'ARCHIVED'
    });

    if (outcome && projectDir) {
      const { recordGoalOutcome } = await import('./orchestration/outcome-recorder.js');
      recordGoalOutcome(this.getGatewayDb(), {
        goalId,
        verdict: outcome.verdict,
        rounds: outcome.rounds,
        lastError: outcome.lastError,
        reviewFeedback: outcome.reviewFeedback,
        projectDir,
        mafwDir: path.join(projectDir, '.mafw'),
        projectId: projectDir,
      });
    }

    // B4: reward-modulated energy — a PASS verdict strengthens the memories
    // written during this goal's sessions (asymmetric: failure never drains).
    // Fail-open; rides the replay loop via the shared need×gain priority.
    if (outcome?.verdict === 'PASS' && this.memoryService) {
      try {
        const { applyGoalReward } = await import('./core/manager/goal-reward.js');
        const sessions = this.getGatewayDb()
          .listGoalSessions(goalId)
          .map((s: any) => s.session_id);
        const r = applyGoalReward(
          { index: this.memoryService.harmonicIndex, sessions },
          outcome.verdict,
        );
        log.info(`[GoalReward] goal ${goalId}: rewarded ${r.rewarded} memories (+0.08 each, clamped)`);
      } catch (err: any) {
        log.warn(`[GoalReward] failed for ${goalId} (non-fatal): ${err?.message || err}`);
      }
    }

    if (projectDir) this.getMilestonePush()?.onArchived(goalId, projectDir, outcome?.verdict ?? 'CANCELLED');
    await this.finishPodGoal(goalId, outcome);

    log.info(`[Scheduler] Goal ${goalId} archived`);
  }

  private async finishPodGoal(
    goalId: string,
    outcome?: { verdict: string; reviewFeedback?: string | null },
  ): Promise<void> {
    const podId = this.podService?.getPodIdForGoal(goalId);
    const existingGoal = podId ? this.podStore?.getGoalByGoalId(goalId) : null;
    const alreadyClosed = existingGoal?.status === 'done' || existingGoal?.status === 'aborted';
    if (podId && !alreadyClosed && this.podWorktreeService) {
      const goal = this.podStore?.getGoalByGoalId(goalId);
      const revision = goal?.activeRevision ?? 1;
      try {
        await this.podWorktreeService.commitPending(podId, goalId, revision);
      } catch (err: any) {
        log.warn(`[Pod] worktree commit failed for ${goalId}#${revision} (non-fatal): ${err?.message ?? err}`);
      }
    }
    if (podId && this.podMemoryService && !alreadyClosed) {
      try {
        const mafwDir = this.goalDriverMafwDirCache.get(goalId);
        const state = mafwDir ? loadGoalState(mafwDir, goalId) : this.activeGoals.get(goalId);
        this.podMemoryService.captureGoal(podId, {
          goalId,
          ok: outcome?.verdict === 'PASS' || outcome?.verdict === 'UNREVIEWED',
          reviewFeedback: outcome?.reviewFeedback ?? undefined,
          receiptPath: (state as any)?.receiptPath ?? undefined,
        });
      } catch (err: any) {
        log.warn(`[Pod] memory capture failed for ${goalId} (non-fatal): ${err?.message ?? err}`);
      }
    }
    if (podId && outcome) {
      // 归档路径对两种 verdict 都 reconcile（幂等）：PASS 正常由 review 节点投影收口，
      // 但事件丢失时任务会永远停在 review，这里兜底。
      try {
        const successful = outcome.verdict === 'PASS' || outcome.verdict === 'UNREVIEWED';
        this.podTaskService.reconcileArchive(podId, goalId, successful);
      } catch (err: any) {
        log.warn(`[Pod] archive reconcile failed for ${goalId} (non-fatal): ${err?.message ?? err}`);
      }
    }
    if (podId && outcome && !alreadyClosed) {
      // 归档决策记录：定向发给 Lead（走既有 push/pull），让常驻会话拿到阶段决策；
      // 不广播，避免污染 Builder/Reviewer 的 [POD HANDOFF]。
      try {
        const lead = this.podStore.getMemberByRole(podId, 'lead');
        if (lead) {
          const state: any = (() => {
            const mafwDir = this.goalDriverMafwDirCache.get(goalId);
            return mafwDir ? loadGoalState(mafwDir, goalId) : this.activeGoals.get(goalId);
          })();
          const rounds = Math.max(1, Number(state?.round ?? 1) - 1);
          const failed = Array.isArray(state?.reviewFix?.tasks) ? state.reviewFix.tasks.length : 0;
          this.podMessageService.send({
            podId,
            fromMemberId: lead.id,
            toMemberId: lead.id,
            kind: 'decision',
            body: `[goal 摘要] ${goalId} ${outcome.verdict} · rounds=${rounds}${failed > 0 ? ` · 复核失败项 ${failed}` : ''}`,
          });
        }
      } catch (err: any) {
        log.warn(`[Pod] decision note failed for ${goalId} (non-fatal): ${err?.message ?? err}`);
      }
    }
    // Event layer: the human hears about every terminal Goal — including FAIL /
    // MAX_RETRIES / ERROR, which the PASS-only notifyResult path never covered.
    if (podId && outcome && this.podEventService) {
      try {
        const goal = this.podStore?.getGoalByGoalId(goalId);
        const revision = goal?.activeRevision ?? 1;
        const cls = classifyGoalArchive({ verdict: (outcome.verdict as any) ?? null });
        const pod = this.podStore?.getPod(podId);
        const title = this.describePodGoal(goalId)?.title || goalId;
        const evt = this.podEventService.record({
          ...cls,
          podId,
          projectId: pod?.projectDir ?? '',
          goalId,
          revision,
          title: `${title} · ${outcome.verdict}`,
          dedupeKey: goalDedupeKey(goalId, revision),
        });
        this.broadcast({
          type: 'pod.event',
          properties: {
            podId: evt.podId, eventId: evt.id, goalId: evt.goalId,
            revision: evt.revision, kind: evt.kind, severity: evt.severity,
          },
        });
      } catch (err: any) {
        log.warn(`[Pod] event write failed for ${goalId} (non-fatal): ${err?.message ?? err}`);
      }
    }
    // 完成通知（spec §8.1）：Reviewer 判 PASS 后由 Lead 通知用户——revision 保持
    // 真实完成结果，只广播一条结果事件；不创建人类 attention，也不需要用户再点
    // 一次「验收通过」。同一 revision 的重复通知由 revision 级去重兜底。
    if (podId && (outcome?.verdict === 'PASS' || outcome?.verdict === 'UNREVIEWED')) {
      try {
        await this.podGoalService?.notifyResult(podId, goalId);
      } catch (err: any) {
        log.warn(`[Pod] result notification failed for ${goalId} (non-fatal): ${err?.message ?? err}`);
      }
    }
    try {
      await this.podGoalService?.onGoalArchived(goalId, { verdict: outcome?.verdict });
    } catch (err: any) {
      log.warn(`[Pod] goal archive hook failed for ${goalId} (non-fatal): ${err?.message ?? err}`);
    }
  }

  /**
   * A2A artifact roots for a Pod: the revision worktree (when still active)
   * comes first so unmerged work is visible; merged/abandoned/missing rows fall
   * back to the project checkout. Re-evaluated per lookup (see resolver ctor).
   */
  private podArtifactRoots(podId: string): {
    worktreeDir?: string;
    projectDir?: string;
    artifactRoot: string;
  } {
    const pod = this.podStore.getPod(podId);
    const active = this.podStore.getActiveGoal(podId);
    const goals = active ? [active] : [...this.podStore.listGoals(podId)].reverse();
    let worktreeDir: string | undefined;
    for (const goal of goals) {
      const worktree = this.podStore.getGoalWorktree(podId, goal.goalId, goal.activeRevision);
      if (worktree?.status === 'active') {
        worktreeDir = worktree.dir;
        break;
      }
    }
    return {
      worktreeDir,
      projectDir: pod?.projectDir,
      artifactRoot: path.join(os.homedir(), '.mafw', 'pods', podId, 'artifacts'),
    };
  }

  private podA2AAgent(podId: string): PodA2AAgent | null {
    const pod = this.podStore.getPod(podId);
    if (!pod) return null;
    let agent = this.podA2AAgents.get(podId);
    if (!agent) {
      agent = new PodA2AAgent({
        bridge: this.podA2ABridge,
        podId,
        podName: pod.name,
        baseUrl: `http://127.0.0.1:${config.server.apiPort}`,
        artifactRoot: path.join(os.homedir(), '.mafw', 'pods', podId, 'artifacts'),
        projectDir: pod.projectDir,
        roots: () => this.podArtifactRoots(podId),
      });
      this.podA2AAgents.set(podId, agent);
    }
    return agent;
  }

  private podCost(podId: string): { spentUsd: number; limitUsd: number } {
    return this.podBudget?.cost(podId) ?? { spentUsd: 0, limitUsd: 0 };
  }

  private podTranscript(podId: string, sessionId: string): unknown {
    const snapshot = this.podStore.getSnapshotForPod(podId, sessionId);
    if (!snapshot) return null;
    try {
      return JSON.parse(fs.readFileSync(snapshot.path, 'utf-8'));
    } catch {
      return null;
    }
  }

  private onPodGoalNode(p: {
    type?: string;
    goalId?: string;
    loop?: number;
    node?: string;
    transition?: string;
    outcome?: string;
  }): void {
    if (p?.type !== 'goal_node' || !p.goalId || !p.node) return;
    const podId = this.podService?.getPodIdForGoal(p.goalId);
    if (!podId) return;
    if (p.transition === 'started') {
      try {
        if (p.node === 'plan') this.podTaskService.clearProjected(podId, p.goalId);
        else if (p.node === 'execute') this.podTaskService.startExecution(podId, p.goalId);
      } catch (err: any) {
        log.warn(`[Pod] goal node start projection failed for ${p.goalId}/${p.node} (non-fatal): ${err?.message ?? err}`);
      }
      return;
    }
    if (p.transition !== 'finished') return;
    const mafwDir = this.goalDriverMafwDirCache.get(p.goalId);
    const state: any = mafwDir ? loadGoalState(mafwDir, p.goalId) : this.activeGoals.get(p.goalId);
    if (!state) return;
    try {
      if (p.node === 'plan' && state.wavePlanPath) {
        const plan = JSON.parse(fs.readFileSync(state.wavePlanPath, 'utf-8'));
        this.podTaskService.projectWaves(podId, p.goalId, plan);
      } else if (p.node === 'execute' && state.receiptPath) {
        const receipt = JSON.parse(fs.readFileSync(state.receiptPath, 'utf-8'));
        this.podTaskService.applyReceipt(podId, p.goalId, receipt);
      } else if (p.node === 'review') {
        const rubric = this.readReviewRubric(state);
        if (rubric && rubric.tasks.length > 0) {
          this.podTaskService.applyReviewResults(podId, p.goalId, rubric.tasks);
        } else if (state.reviewVerdict === 'FAIL') {
          this.podTaskService.reopenForReview(podId, p.goalId);
        } else if (state.reviewVerdict === 'PASS') {
          this.podTaskService.reconcileArchive(podId, p.goalId, true);
        } else if (state.lastError) {
          this.podTaskService.reconcileArchive(podId, p.goalId, false);
        }
      }
    } catch (err: any) {
      log.warn(`[Pod] goal node projection failed for ${p.goalId}/${p.node} (non-fatal): ${err?.message ?? err}`);
    }
  }

  /** 读 review 报告并按 waves 任务清单解析 rubric；缺失/不合法 → null（回退旧行为）。 */
  private readReviewRubric(state: any): { tasks: Array<{ taskId: string; result: 'pass' | 'fail' | 'skipped' }> } | null {
    try {
      const report = state?.reviewReportPath;
      if (!report || !fs.existsSync(report)) return null;
      let taskIds: string[] = [];
      try {
        const wavesPath = state?.wavePlanPath;
        if (wavesPath && fs.existsSync(wavesPath)) {
          taskIds = taskIdsFromWavePlan(JSON.parse(fs.readFileSync(wavesPath, 'utf-8')));
        }
      } catch { taskIds = []; }
      const rubric = parseReviewRubric(fs.readFileSync(report, 'utf-8'), taskIds);
      return { tasks: rubric.tasks.map((task) => ({ taskId: task.taskId, result: task.result })) };
    } catch (err: any) {
      log.warn(`[Pod] review rubric parse failed (non-fatal): ${err?.message ?? err}`);
      return null;
    }
  }

  // ── 9. 恢复 ──

  /** 收集所有注册项目的 state 引用（NodeDriver 恢复/watchdog 用）。 */
  private listGoalStates(): Array<{ goalId: string; mafwDir: string; projectDir: string }> {
    const out: Array<{ goalId: string; mafwDir: string; projectDir: string }> = [];
    for (const [projectDir, info] of this.registeredProjects) {
      const stateDir = path.join(info.mafwDir, 'state');
      if (!fs.existsSync(stateDir)) continue;
      for (const f of fs.readdirSync(stateDir)) {
        if (f.endsWith('.json')) out.push({ goalId: f.replace(/\.json$/, ''), mafwDir: info.mafwDir, projectDir });
      }
    }
    return out;
  }

  private async recoverState() {
    for (const [projectDir, info] of this.registeredProjects) {
      const stateDir = path.join(info.mafwDir, 'state');
      if (!fs.existsSync(stateDir)) continue;

      const stateFiles = fs.readdirSync(stateDir).filter(f => f.endsWith('.json'));
      for (const file of stateFiles) {
        try {
          const statePath = path.join(stateDir, file);
          const state: StateFile = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
          if (state.nextAction !== 'COMPLETED' && state.nextAction !== 'FAILED') {
            this.activeGoals.set(state.goalId, state);
            log.info(`[Scheduler] Recovered goal ${state.goalId} at ${state.phase}`);
          }
        } catch (err: any) {
          log.warn(`[Scheduler] Failed to recover ${file}: ${err.message}`);
        }
      }
    }

    // NodeDriver 崩溃恢复（spec §6）：产物优先 → 会话探测 → 节点重试/归档。
    if (this.goalDriver) {
      const states = this.listGoalStates();
      for (const s of states) {
        this.goalDriverMafwDirCache.set(s.goalId, s.mafwDir);
        this.goalDriver.registerGoalDir(s.goalId, s.mafwDir);
      }
      await recoverGoals({
        driver: this.goalDriver,
        states,
        probeSession: this.runtimeCaps.sessionStorageApi
          ? async (sid) => {
              try { const info = await this.runtime!.session.get({ sessionID: sid }); return info ? 'alive' : 'dead'; }
              catch { return 'dead'; }
            }
          : undefined,
      });
    }
  }

  // 鈹€鈹€ 10. 鎺у埗鏂囦欢澶勭悊 鈹€鈹€

  private async processControlFile() {
    for (const [, info] of this.registeredProjects) {
      const controlPath = path.join(info.mafwDir, 'control');
      if (!fs.existsSync(controlPath)) continue;

      try {
        const control = JSON.parse(fs.readFileSync(controlPath, 'utf-8'));
        log.info(`[Scheduler] Control action: ${control.action} ${control.goalId || ''}`);

        switch (control.action) {
          case 'PAUSE':
            if (control.goalId) {
              await this.patchState(control.goalId, { nextAction: 'PAUSED' });
            }
            break;
          case 'ABORT':
            if (control.goalId) {
              await this.destroyAllSessions(control.goalId);
              await this.patchState(control.goalId, { nextAction: 'FAILED' });
              const state2 = this.activeGoals.get(control.goalId);
              await this.archiveGoal(control.goalId, {
                verdict: 'CANCELLED',
                rounds: state2?.loop ?? 0,
              });
            }
            break;
          case 'FORCE_PHASE':
            if (control.goalId && control.targetPhase) {
              await this.destroyAllSessions(control.goalId);
              await this.patchState(control.goalId, {
                nextAction: `CREATE_${control.targetPhase.toUpperCase()}_SESSION`
              });
            }
            break;
          case 'RESET_PARAMETRIC':
            log.info('[Scheduler] Resetting parametric cache...');
            break;
        }

        fs.unlinkSync(controlPath);
      } catch (err: any) {
        log.error(`[Scheduler] Control file error: ${err.message}`);
      }
    }
  }

  // ── 工具函数（使用 SDK 客户端） ──

  private async createSession(projectDir: string): Promise<Session> {
    if (!this.runtime) throw new Error('runtime not available');
    const created = await this.runtime.session.create({ directory: projectDir });
    if (!created?.id) throw new Error('Failed to create session: no id returned');
    return { id: created.id, createdAt: created.createdAt || new Date().toISOString() };
  }

  private async sendPrompt(sessionId: string, message: string) {
    if (!sessionId) return;
    if (!this.runtime) return;
    await this.runtime.session.promptAsync({
      sessionID: sessionId,
      parts: [{ type: 'text', text: message }],
    });
  }

  private async destroySession(sessionId: string) {
    if (!sessionId) return;
    if (!this.runtime) return;
    try {
      await this.podService?.snapshotSession(sessionId);
    } catch {
      this.podService?.finalizeMissingSession(sessionId);
    }
    try {
      await this.runtime.session.delete({ sessionID: sessionId });
    } catch (err: any) {
      log.warn(`[Scheduler] Failed to destroy session ${sessionId}: ${err.message}`);
    }
  }

  private async destroyAllSessions(goalId: string) {
    const ids = new Set<string>();
    const state = this.activeGoals.get(goalId);
    if (state) {
      for (const [, session] of Object.entries(state.sessions)) {
        if (session.active) ids.add(session.id);
      }
    }
    const podId = this.podService?.getPodIdForGoal(goalId);
    if (podId && this.podStore) {
      for (const session of this.podStore.listActiveSessions(podId, this.runtimeName)) {
        if (session.goalId === goalId && session.node !== 'coordination') ids.add(session.sessionId);
      }
    }
    for (const sessionId of ids) {
      await this.destroySession(sessionId);
    }
  }

  private async patchState(goalId: string, patch: Partial<StateFile>) {
    // 找到 state 文件路径
    let statePath: string | null = null;
    for (const [, info] of this.registeredProjects) {
      const p = path.join(info.mafwDir, 'state', `${goalId}.json`);
      if (fs.existsSync(p)) {
        statePath = p;
        break;
      }
    }

    if (!statePath) {
      log.error(`[Scheduler] State file not found for ${goalId}`);
      return;
    }

    const current: StateFile = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    const updated: StateFile = { ...current, ...patch, updatedAt: new Date().toISOString() };

    // 原子写入
    const tmpPath = `${statePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(updated, null, 2), 'utf-8');
    fs.renameSync(tmpPath, statePath);

    // 更新内存缓存
    this.activeGoals.set(goalId, updated);

    // 广播 state_change 事件到 Dashboard
    this.broadcast({
      type: 'state_change',
      timestamp: new Date().toISOString(),
      goalId,
      data: patch
    });
  }

  private registeredGoalEntries(): GoalProjectEntry[] {
    return Array.from(this.registeredProjects.values())
      .map((info) => ({ projectDir: info.projectDir, mafwDir: info.mafwDir }));
  }

  private resolveGoalProject(
    goalId: string,
    projectDirHint?: string,
  ):
    | { ok: true; projectDir: string; mafwDir: string; info: RegisteredProject }
    | Extract<GoalResolution, { ok: false }> {
    const resolution = resolveGoalRefFromEntries(
      this.registeredGoalEntries(),
      goalId,
      projectDirHint ? { projectDir: projectDirHint } : undefined,
    );
    if (!resolution.ok) return resolution;
    const wanted = canonicalProjectDir(resolution.ref.projectDir);
    const info = Array.from(this.registeredProjects.values())
      .find((project) => canonicalProjectDir(project.projectDir) === wanted);
    if (!info) return { ok: false, reason: 'not_found', candidates: [] };
    return {
      ok: true,
      projectDir: resolution.ref.projectDir,
      mafwDir: resolution.mafwDir,
      info,
    };
  }

  private findGoalStatePath(goalId: string): { statePath: string; info: RegisteredProject } | null {
    const resolved = this.resolveGoalProject(goalId);
    if (!resolved.ok || !resolved.info || !resolved.projectDir) return null;
    const statePath = path.join(resolved.mafwDir, 'state', `${goalId}.json`);
    return fs.existsSync(statePath)
      ? { statePath, info: resolved.info }
      : null;
  }

  private findGoalRequestDir(goalId: string): string | null {
    const resolved = this.resolveGoalProject(goalId);
    return resolved.ok && findGoalRequestPath(resolved.mafwDir, goalId)
      ? resolved.mafwDir
      : null;
  }

  /** Goal 的 mafw 目录：state 与两种 request 布局都由规范身份解析。 */
  private findGoalMafwDir(goalId: string): string | null {
    const resolved = this.resolveGoalProject(goalId);
    return resolved.ok ? resolved.mafwDir : null;
  }

  /**
   * Task 14：NodeDriver 的 Spike 端口。driver 只知道"入队 / 取一条 / 读报告 / 隔离工作区 /
   * 会话范围绑定"；持久化、单飞、脱敏全部落在 PodProbeService（Task 9）。
   */
  private buildGoalProbePort(): GoalProbePort {
    const probePath = (goalId: string, probeId: string): string => {
      const mafwDir = this.findGoalMafwDir(goalId);
      if (mafwDir) {
        try { return probeReportPath(mafwDir, goalId, probeId); } catch { /* fall through */ }
      }
      // 兜底路径只用于 prompt 展示与 missing 报错，不承担权威写入。
      return path.join(this.mafwDir ?? config.resolvePath(), 'goals', goalId, 'probes', `${probeId}.report.json`);
    };

    return {
      podIdForGoal: (goalId) => this.podService?.getPodIdForGoal(goalId) ?? null,
      enqueue: ({ podId, goalId, revision, drafts }) => this.podProbeService.requestMany(
        drafts.map((draft) => ({
          podId, goalId, revision,
          question: draft.question,
          hypothesis: draft.hypothesis,
          scope: draft.scope,
          budget: draft.budget,
          evidenceRequired: draft.evidenceRequired,
          affects: draft.affects,
        })),
      ).map((probe) => probe.id),
      take: ({ podId, goalId, probeIds }) => {
        // Pod-global FIFO 由 PodProbeService.claimForGoal 保证：不是本 goal 的队头
        // （或别的 goal 正在跑）就返回 null，绝不把别人的探针标成 running 后丢弃。
        const claimed = this.podProbeService.claimForGoal(podId, goalId, probeIds);
        return claimed ? claimed.request : null;
      },
      report: (probeId) => {
        const row = this.podStore.getProbe(probeId);
        if (!row || row.status !== 'completed' || !row.reportJson) return null;
        try { return JSON.parse(row.reportJson) as ProbeReport; } catch { return null; }
      },
      complete: (probeId, report) => this.podProbeService.complete(probeId, report) as ProbeReport,
      failProbe: (probeId, reason) => {
        try { this.podProbeService.fail(probeId, reason); } catch { /* fail-open：已完成/已取消的探针不动 */ }
      },
      requeueProbe: (probeId, reason) => {
        try { this.podProbeService.requeue(probeId, reason); } catch { /* fail-open */ }
      },
      reportPath: (goalId, probeId) => probePath(goalId, probeId),
      prepareWorkspace: async ({ projectDir, goalId, probeId }) => {
        const workspace = await this.podProbeWorkspaces.prepare(projectDir, goalId, probeId);
        return { dir: workspace.dir, dispose: () => this.podProbeWorkspaces.dispose(workspace) };
      },
      disposeWorkspace: async (workspace) => { await workspace.dispose(); },
      bindSession: (sessionId, binding) => {
        if (binding) this.probeScopes.set(sessionId, binding);
        else this.probeScopes.delete(sessionId);
      },
    };
  }

  /** 跨项目 presence：桌面 main 每 15s 拉一次，托盘/任务栏的唯一数据源。 */
  private buildPresence(): PodPresence {
    const inputs = [];
    for (const pod of this.podStore?.listPods() ?? []) {
      if (pod.status === 'archived') continue;
      const views = this.podGoalService?.views(pod.id) ?? [];
      const parent = parentProjectDirForWorktree(pod.projectDir);
      inputs.push({
        podId: pod.id,
        projectId: pod.projectDir,
        ...(parent ? { parentProjectId: parent } : {}),
        projectName: pod.name || pod.projectDir,
        goals: views,
        tasks: (this.podStore?.listTasks(pod.id) ?? []).map((task) => ({
          goalId: task.goalId ?? null,
          status: task.status,
        })),
        attention: this.podGoalService?.attention(pod.id) ?? [],
        unread: (this.podEventService?.list(pod.id, { state: 'unread', limit: 500 }).items ?? [])
          .filter((event) => event.severity === 'p1')
          .map((event) => ({ goalId: event.goalId, revision: event.revision })),
      });
    }
    return buildPodPresence(inputs);
  }

  private describePodGoal(goalId: string): PodGoalDescription | null {
    const found = this.findGoalStatePath(goalId);
    const mafwDir = found?.info.mafwDir ?? this.findGoalRequestDir(goalId);
    if (!mafwDir) return null;
    const request: any = readGoalRequest(mafwDir, goalId);
    const state = found ? loadGoalState(found.info.mafwDir, goalId) : null;
    if (!state) {
      // Queued goals have an intake request but no state file yet. Their title
      // and stage still come from the request; only an active goal with no
      // state is a real inconsistency (stateMissing → blocked).
      return {
        title: typeof request?.title === 'string' && request.title.trim() ? request.title : '',
        phase: null,
        nextAction: '',
        terminal: false,
        verdict: null,
        hasResultEvidence: false,
        planApproval: null,
        pendingQuestion: null,
        nodeSession: null,
        lastError: null,
        stateMissing: true,
        sourceRef: request?.sourceRef ?? null,
        strategy: null,
        assessment: null,
        currentAssignment: null,
      };
    }
    const terminal = isTerminalState(state);
    const verdict = goalVerdictFromState(state);
    const strategy = (state as any).strategy === 'quick' || (state as any).strategy === 'collaborative'
      ? (state as any).strategy
      : null;
    const assessment = (state as any).assessment === 'reviewed' || (state as any).assessment === 'unreviewed'
      ? (state as any).assessment
      : null;
    const currentAssignment = state.currentAssignmentId
      ? currentAssignmentSummary(
        mafwDir,
        goalId,
        effectiveRevision(state),
        state.currentAssignmentId,
      )
      : null;
    return {
      title: typeof request?.title === 'string' && request.title.trim() ? request.title : '',
      phase: state.phase ?? null,
      nextAction: state.nextAction,
      terminal,
      verdict,
      hasResultEvidence: !!(
        state.receiptPath
        || state.reviewReportPath
        || Object.keys(state.artifacts ?? {}).length > 0
        || state.reviewVerdict
      ),
      planApproval: (state.planApproval ?? null) as any,
      pendingQuestion: state.pendingQuestion
        ? {
          questionId: state.pendingQuestion.questionId,
          node: state.pendingQuestion.node,
          questions: state.pendingQuestion.questions,
        }
        : null,
      nodeSession: state.nodeSession,
      lastError: state.lastError,
      sourceRef: request?.sourceRef ?? null,
      strategy,
      assessment,
      currentAssignment,
    };
  }

  private readPodGoalResult(goalId: string) {
    const found = this.findGoalStatePath(goalId);
    if (!found) return null;
    const state = loadGoalState(found.info.mafwDir, goalId);
    if (!state) return null;
    const request = readGoalRequest(found.info.mafwDir, goalId);
    return buildPodGoalResult({
      goalId,
      state,
      request,
      readText: (target) => {
        try { return fs.existsSync(target) ? fs.readFileSync(target, 'utf-8') : null; } catch { return null; }
      },
    });
  }

  private async handleValidate(goalId: string, data?: { projectDir?: string }): Promise<any> {
    setImmediate(() => void this.startGoal(goalId, data?.projectDir));
    return { success: true, goalId, nextAction: 'GRAPH_INVOKED' };
  }

  /** Goal starter wrapper：所有 goal 创建路径都先过 Pod 单 active goal 队列。 */
  private async startGoal(goalId: string, projectDirHint?: string): Promise<void> {
    try {
      await this.podGoalService.enqueueGoal(goalId, projectDirHint);
    } catch (err: any) {
      log.error(`[Goal] ${goalId}: pod queue/start failed: ${err?.message ?? err}`);
    }
  }

  /** Goal starter（spec §4）：定位目标项目 → ensureState(v3) → NodeDriver.advance。 */
  private async startGoalDirect(goalId: string, projectDirHint?: string): Promise<void> {
    // 讨论中的 Goal 只有方向工具把 revision 推到 planning 后才能启动；paused/resume、
    // 队列提升或任何重试路径都不能绕过这道门。
    if (!this.podGoalService.isStartable(goalId)) {
      log.warn(`[Goal] ${goalId}: refusing to start before a direction decision`);
      return;
    }
    const resolved = this.resolveGoalProject(goalId, projectDirHint);
    if (!resolved.ok) {
      const detail = resolved.reason === 'ambiguous'
        ? `ambiguous projects: ${resolved.candidates.join(', ')}`
        : 'no project dir resolved';
      log.warn(`[Goal] ${goalId}: ${detail} — skipping`);
      throw new Error(`${detail} for goal ${goalId}`);
    }
    const found = { projectDir: resolved.projectDir, mafwDir: resolved.mafwDir };
    const requestPath = findGoalRequestPath(found.mafwDir, goalId);
    const request = readGoalRequest(found.mafwDir, goalId);
    this.goalDriverMafwDirCache.set(goalId, found.mafwDir);
    this.goalDriver?.registerGoalDir(goalId, found.mafwDir);
    ensureGoalState(found.mafwDir, goalId, {
      projectDir: found.projectDir,
      maxRounds: config.loop.maxRounds,
      // W1: creation-time plan review mode (validated enum; absent = auto).
      planReview: request?.planReview === 'manual'
        ? 'manual'
        : (request?.planReview === 'auto' ? 'auto' : undefined),
      policySnapshot: mergeBudgetIntoSnapshot(
        (() => { try { return getActivePolicy(config.resolvePath()); } catch { return { version: 'builtin-v1', proposalId: null }; } })(),
        // goal-dir 布局的 request 与 legacy 同源解析（budget 不能丢）。
        requestPath ?? path.join(found.mafwDir, 'requests', `${goalId}.json`),
      ),
      // D4b: creation-time task type declaration (plan node write-back wins).
      taskType: isTaskType(request?.taskType) ? (request!.taskType as any) : undefined,
    });
    this.activeGoals.set(goalId, loadGoalState(found.mafwDir, goalId) as any);
    await this.goalDriver?.advance(goalId);
  }

  private async handleComplete(goalId: string, data?: { score?: number }): Promise<any> {
    setImmediate(() => void this.goalDriver?.advance(goalId));
    return { success: true, nextAction: 'SCHEDULED' };
  }

  private async handleCompress(observations: string[], model?: string): Promise<any> {
    log.info(
      `[llm/compress] called observations=${observations.length} first=${(observations[0] || '').slice(0, 100)}`,
    );
    const prompt = `Analyze the following agent observations and extract structured memories.
Return JSON only:
{
  "narrative": "summary of what happened",
  "facts": ["specific fact 1", "specific fact 2"],
  "concepts": ["keyword1", "keyword2"],
  "energy": 0.5
}

Observations:
${observations.map((o, i) => `[${i + 1}] ${o}`).join('\n')}`;

    const systemPrompt = 'You are a memory compression system. Extract structured memories from observations. Return ONLY valid JSON.';

    if (!this.runtime) {
      return { narrative: 'No LLM client available', facts: [], concepts: [], energy: 0.3 };
    }

    let sessionId: string | null = null;
    try {
      const session = await this.runtime.session.create({ directory: this.resolvedProjectDir() });
      sessionId = session.id;
      if (!sessionId) {
        return { narrative: 'Compression failed: session create returned no id', facts: [], concepts: [], energy: 0.3 };
      }
      const result = await this.runtime.session.prompt({
        sessionID: sessionId,
        parts: [{ type: 'text', text: prompt }],
        system: systemPrompt,
        ...(model ? { model: { providerID: 'opencode', modelID: model } } : {}),
      });
      const text = result.parts
        ?.filter((p: any) => p.type === 'text')
        .map((p: any) => p.text)
        .join('\n') || '';
      return this.parseLLMResponse(text);
    } catch (err: any) {
      return { narrative: 'Compression failed: ' + err.message, facts: [], concepts: [], energy: 0.3 };
    } finally {
      if (sessionId) {
        try { await this.runtime.session.delete({ sessionID: sessionId }); } catch {}
      }
    }
  }

  private parseLLMResponse(text: string): any {
    try {
      const parsed = JSON.parse(text);
      return {
        narrative: parsed.narrative || '',
        facts: Array.isArray(parsed.facts) ? parsed.facts : [],
        concepts: Array.isArray(parsed.concepts) ? parsed.concepts : [],
        energy: typeof parsed.energy === 'number' ? parsed.energy : 0.5
      };
    } catch {
      return { narrative: text.slice(0, 200), facts: [], concepts: [], energy: 0.5 };
    }
  }

  private async loadRequest(goalId: string): Promise<any> {
    for (const [, info] of this.registeredProjects) {
      const request = readGoalRequest(info.mafwDir, goalId);
      if (request) return request;
    }
    return null;
  }

  // 鈹€鈹€ LangGraph Node Options 鈹€鈹€

  async goalSource(goalId: string): Promise<{ sourceRef: unknown; handoffPath: string | null; fullText: string | null }> {
    const request = await this.loadRequest(goalId);
    const mafwDir = this.goalDriverMafwDirCache.get(goalId)
      ?? this.findGoalStatePath(goalId)?.info.mafwDir;
    const handoffPath = mafwDir
      ? path.join(mafwDir, 'goals', goalId, 'context', 'lead-handoff.md')
      : null;
    const fullText = handoffPath && fs.existsSync(handoffPath)
      ? fs.readFileSync(handoffPath, 'utf8')
      : null;
    return {
      sourceRef: (request as any)?.sourceRef ?? null,
      handoffPath: fullText ? handoffPath : null,
      fullText,
    };
  }

  private async handleDashboardAPI(req: http.IncomingMessage): Promise<any> {
    if (req.url?.startsWith("/api/goals")) {
      return {
        goals: Array.from(this.activeGoals.values()).map(s => ({
          goalId: s.goalId,
          phase: s.phase,
          loop: s.loop,
          nextAction: s.nextAction,
          error: s.error || null,
          updatedAt: s.updatedAt,
        })),
      };
    }
    if (req.url?.startsWith("/api/stats")) {
      const base = {
        activeGoals: this.activeGoals.size,
        registeredProjects: this.registeredProjects.size,
        sseClients: this.sseClients.size,
        serveRunning: this.serveRunning,
      };
      try {
        const store = this.trajectoryStore;
        if (store) {
          const global = store.getGlobalTokenSummary();
          return { ...base, tokens: global };
        }
      } catch (err: any) {
        log.warn(`[Stats] token summary failed: ${err.message}`);
      }
      return base;
    }
    if (req.url === '/api/memory/add' && req.method === 'POST') {
      const body = await new Promise<string>((resolve) => {
        let b = '';
        req.on('data', (c: Buffer) => (b += c.toString('utf-8')));
        req.on('end', () => resolve(b));
      });
      try {
        const data = JSON.parse(body);
        const content = String(data?.content || '').trim();
        const memoryType = String(data?.memoryType || 'semantic');
        if (!content || !['episodic', 'semantic', 'procedural', 'global'].includes(memoryType)) {
          return { success: false, error: 'content and valid memoryType required' };
        }
        // V2 ①b L1: exact-content guard — skip verbatim re-submits (worker
        // double-writes). LRU is in-memory; read-time collapse backstops.
        if (config.memory.dedup?.exactHash !== false) {
          const { exactHashOf, seenExactHash } = require('./memory/dedup-guard.js');
          if (seenExactHash(exactHashOf(content))) {
            return { success: true, deduped: true, reason: 'exact-hash' };
          }
        }
        const { normalizeAuthority } = require('./core/memory/harmonic-types.js');
        const authority = normalizeAuthority(data?.authority);
        if (authority === null) {
          return { success: false, error: `invalid authority: ${String(data?.authority)} (user|agent|tool|pipeline)` };
        }
        if (!this.memoryService) return { success: false, error: 'memoryService not ready' };
        const { HarmonicUnitFileStore } = require('./memory/harmonic-file-store.js');
        const { generateHarmonicId } = require('./core/memory/harmonic-types.js');
        const { importanceToSalience } = require('./core/memory/salience-perceptor.js');
        const { judgeSalience } = require('./judge/salience.js');
        const { getEmbeddingRuntime } = require('./memory/embedding-runtime.js');
        const store = new HarmonicUnitFileStore(config.resolvePath(), this.memoryService.harmonicIndex);
        const now = new Date().toISOString();
        let novelty: number | undefined;
        try {
          const rt = getEmbeddingRuntime();
          if (rt) {
            const [v] = await rt.provider.embed([content], 'document');
            if (v) {
              const hits = rt.vectors.searchByCosine(v, 1);
              novelty = hits.length > 0 ? 1 - hits[0].cosine : 1;
            }
          }
        } catch { /* fail-open */ }
        const salience = typeof data?.importance === 'number' && Number.isFinite(data.importance)
          ? importanceToSalience(data.importance)
          : judgeSalience({ text: content, novelty }).score;
        const unit = {
          id: generateHarmonicId(),
          type: memoryType,
          primary_abstraction: String(data?.primaryAbstraction || content).slice(0, 200),
          cue_anchors: Array.isArray(data?.cueAnchors) ? data.cueAnchors.slice(0, 8).map(String) : [],
          memory_value: content.slice(0, 4000),
          energy: 0.8,
          salience,
          novelty,
          abstraction_level: abstractionLevelFor(memoryType),
          created_at: now,
          updated_at: now,
          pinned: data?.pinned === true || undefined,
          // G1: provenance authority — default 'agent' (direct agent write);
          // absent field on legacy entries is treated as 'pipeline' downstream.
          authority: authority ?? 'agent',
          // Sticky note board parity with the MCP mafw_add_memory handler.
          ...(data?.sticky === true ? {
            sticky_until: new Date(Date.now() + (typeof data?.stickyDays === 'number' && data.stickyDays > 0 ? data.stickyDays : 7) * 86400e3).toISOString(),
          } : {}),
          // V1 provenance: pipeline workers write via HTTP with their own
          // session id — map back to the source session for C0 reconstruction.
          source_session_id: (data?.sessionID && require('./recall/worker-origin').resolveWorkerOrigin(String(data.sessionID))) || (data?.sessionID ? String(data.sessionID) : undefined),
        };
        let supersedesTarget: any = null;
        if (data?.supersedes) {
          const sid = String(data.supersedes);
          supersedesTarget = this.memoryService.harmonicIndex.getIndex().entries.find((e: any) => e.id === sid);
          if (!supersedesTarget) return { success: false, error: `supersedes target not found: ${sid}` };
          unit.energy = Math.max(unit.energy, supersedesTarget.energy ?? 0);
        }
        // A2: tentative draft abstractions are energy-capped at write time
        // until the daily reflection pipeline promotes or discards them.
        try {
          const { capTentativeEnergy } = require('./recall/turn-pipeline');
          Object.assign(unit, capTentativeEnergy(unit as any));
        } catch { /* fail-open */ }
        // V2 ⑦: commitment gradient — pipeline worker first-pass writes cap
        // at 0.6; manual/user writes are exempt. Worker detection via the
        // V1 origin registry (registered = pipeline worker session).
        try {
          const { capCommitment } = require('./recall/commitment');
          const isPipelineWorker = Boolean(
            data?.sessionID && require('./recall/worker-origin').resolveWorkerOrigin(String(data.sessionID)));
          Object.assign(unit, capCommitment(unit as any, {
            isPipeline: isPipelineWorker,
            enabled: config.recall?.commitmentGradient !== false,
          }));
        } catch { /* fail-open */ }
        const routeDeps = getRouteWriteDeps();
        if (routeDeps) {
          const routed = await routeAndWrite(unit as any, store as any, routeDeps);
          if (routed.action === 'create' && supersedesTarget && !supersedesTarget.superseded_by) {
            store.markSuperseded(supersedesTarget.id, unit.id);
          }
          return {
            success: true,
            id: routed.id,
            deduped: routed.action === 'skip' ? true : undefined,
            updated: routed.action === 'update' ? routed.targetId : undefined,
            sticky_until: routed.action === 'create' ? (unit as any).sticky_until : undefined,
          };
        }
        await store.write(unit);
        if (supersedesTarget && !supersedesTarget.superseded_by) {
          store.markSuperseded(supersedesTarget.id, unit.id);
        }
        return { success: true, id: unit.id, sticky_until: (unit as any).sticky_until };
      } catch (err: any) {
        log.warn(`[Scheduler] /api/memory/add failed: ${err.message}`);
        return { success: false, error: err.message };
      }
    }
    if (req.url === '/api/memory/pin' && req.method === 'POST') {
      const body = await new Promise<string>((resolve) => {
        let b = '';
        req.on('data', (c: Buffer) => (b += c.toString('utf-8')));
        req.on('end', () => resolve(b));
      });
      try {
        const data = JSON.parse(body);
        const id = String(data?.id || '');
        if (!id) return { success: false, error: 'id required' };
        if (!this.memoryService) return { success: false, error: 'memoryService not ready' };
        const { HarmonicUnitFileStore } = require('./memory/harmonic-file-store.js');
        const store = new HarmonicUnitFileStore(config.resolvePath(), this.memoryService.harmonicIndex);
        const pinned = data?.pinned === true;
        const hasSticky = typeof data?.sticky === 'boolean';
        if (hasSticky) {
          const days = typeof data?.stickyDays === 'number' && data.stickyDays > 0 ? data.stickyDays : 7;
          const until = data.sticky === true ? new Date(Date.now() + days * 86400e3).toISOString() : null;
          const ok = store.setSticky(id, until);
          if (!ok) return { success: false, error: `memory not found: ${id}` };
          return { success: true, id, sticky: data.sticky === true, sticky_until: until ?? undefined };
        }
        const ok = store.setPinned(id, pinned);
        if (!ok) return { success: false, error: `memory not found: ${id}` };
        return { success: true, id, pinned };
      } catch (err: any) {
        log.warn(`[Scheduler] /api/memory/pin failed: ${err.message}`);
        return { success: false, error: err.message };
      }
    }
    if (req.url?.startsWith("/api/memory")) {
      return { status: "ok", message: "Memory API not yet implemented" };
    }
    return { error: "Unknown endpoint" };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }

  // Concurrent calls for the same projectDir (start() loop + /register
  // handler + rotate) must serialize — MutexQueue handles both joiners
  // (ensureManagerSession) and serialized rotate (runManagerExclusive).
  private managerQueue = new MutexQueue();

  private ensureManagerSession(projectDir: string, mafwDir: string): Promise<string> {
    return this.managerQueue.run(projectDir, () => this.createManagerSession(projectDir, mafwDir));
  }

  // Slot-based read of a manager-session kv entry: each runtime owns a slot
  // in the value (byRuntime), so switching runtimes never drops a topic —
  // switching back resumes the previous manager. Ownership is explicit: reads
  // only honour the persisted `runtime` tag (untagged legacy rows are tagged
  // once at startup by `backfillManagerSessionSlots`).
  // See manager-session-runtime.ts.
  private readManagerSessionEntry(projectDir: string): { sessionId: string; createdAt?: string | null } | null {
    const current = this.leadSessionRegistry.current(projectDir);
    return current ? { sessionId: current.sessionId, createdAt: current.createdAt } : null;
  }

  /**
   * 一次性归属补齐（review I3）：单 runtime 时代写的 legacy 行没有 runtime tag，
   * `readManagerSlot`（正确地）不猜归属 → 行永远休眠，新会话顶掉旧 topic 后旧 topic
   * 又"复活"。迁移时已经把 legacy 文件标成 opencode；这里兜存量 DB 里的 untagged 行。
   * 幂等；任何失败 fail-open（保留原值）。
   */
  private backfillManagerSessionSlots(): void {
    try {
      const rows = this.getGatewayDb().kvAll<unknown>('manager-session');
      let changed = 0;
      for (const row of rows) {
        const next = backfillManagerSlot(row.value);
        if (!next.changed) continue;
        this.getGatewayDb().kvSet('manager-session', row.key, next.value);
        changed++;
      }
      if (changed > 0) log.info(`[Scheduler] manager-session backfill: ${changed} legacy rows tagged`);
    } catch (err: any) {
      log.warn(`[Scheduler] manager-session backfill failed (non-fatal): ${err.message}`);
    }
  }

  // Serialized rotate: queues behind any in-flight ensure/create for the same
  // project so rotate and lazy-init never double-create (spec §4).
  private async runManagerExclusive<T>(projectDir: string, fn: () => Promise<T>): Promise<T> {
    return this.managerQueue.run(projectDir, fn);
  }

  private async createManagerSession(projectDir: string, _mafwDir: string): Promise<string> {
    const lead = await this.leadSessionRegistry.ensure(projectDir);
    log.info(`[Scheduler] Lead session ready: ${lead.sessionId} (${lead.source})`);
    return lead.sessionId;
  }

  private mafwDirFor(projectDir: string): string {
    return this.registeredProjects.get(projectDir)?.mafwDir ?? path.join(projectDir, '.mafw');
  }

  /** Runtime switch invalidates every runtime session id: recover each Pod Lead once. */
  private async reconcilePodLeads(): Promise<void> {
    if (!this.podStore) return;
    for (const pod of this.podStore.listPods()) {
      try {
        await this.ensureManagerSession(pod.projectDir, this.mafwDirFor(pod.projectDir));
      } catch (err: any) {
        log.warn(`[Lead] runtime-switch recovery failed for ${pod.projectDir} (non-fatal): ${err?.message ?? err}`);
      }
    }
  }

  private async syncPodLead(projectDir: string, sessionId: string): Promise<void> {
    if (!this.podService || !this.podStore || !sessionId) return;
    const pod = this.podStore.getPodByProject(canonicalProjectDir(projectDir));
    if (!pod) return;
    try {
      await this.podService.bindLead(pod.id, sessionId);
    } catch (err: any) {
      log.warn(`[Pod] lead rebind failed for ${projectDir} (non-fatal): ${err?.message ?? err}`);
    }
  }

  private rotateDeps(): ManagerRotateDeps {
    return {
      getManagerSession: (pd) => this.readManagerSessionEntry(pd),
      lock: <T,>(pd: string, fn: () => Promise<T>) => this.runManagerExclusive(pd, fn),
      ensure: (pd) => this.ensureManagerSession(pd, this.mafwDirFor(pd)),
      downgrade: async (sid) => {
        // Same archive path as normal Lead replacement: visible history, no
        // current-Lead/identity binding.
        await this.archiveLeadSession(sid);
      },
      create: (pd) => this.rotateCreateManagerSession(pd),
    };
  }

  rotateManagerSessionFor(projectDir: string): Promise<ManagerRotateResult> {
    return runManagerRotate(projectDir, this.rotateDeps());
  }

  private mafwCommandRegistry: MafwCommandRegistry | null = null;

  /** 命令注册表懒构建：内置 6 命令 handler 绑定到本类依赖（P0 收敛，见 §5.13c）。 */
  private getMafwCommandRegistry(): MafwCommandRegistry {
    if (this.mafwCommandRegistry) return this.mafwCommandRegistry;
    this.mafwCommandRegistry = buildMafwCommandRegistry({
      ensureManagerSession: async (projectDir) => {
        const id = await this.ensureManagerSession(projectDir, this.mafwDir).catch(() => '');
        return id || '';
      },
      createSession: async (projectDir) => {
        const s = await this.runtime?.session.create({ directory: projectDir }).catch(() => null);
        return s?.id ?? null;
      },
      promptAsync: async (sid, text) => {
        await this.runtime!.session.promptAsync({ sessionID: sid, parts: [{ type: 'text', text }] });
      },
      listMessages: async (sid) => {
        const r = await this.runtime!.session.messages({ sessionID: sid, limit: 50 });
        return (r?.data || []) as any;
      },
      btwAsk: (q) => this.btwAsk(q),
      mergeMemory: async (sourceWorktree, strategy) => {
        const { handleMergeMemory } = await import('./mcp/handlers/merge-memory.js');
        const result = await handleMergeMemory({ sourceWorktree, resolveStrategy: strategy } as any, {
          memory: this.memoryService,
        } as any);
        const text = result.content?.[0]?.text || '{}';
        try { return JSON.parse(text); } catch { return { text }; }
      },
      readStatus: () => {
        const statusPath = path.join(this.mafwDir, 'STATUS.md');
        return fs.existsSync(statusPath) ? fs.readFileSync(statusPath, 'utf-8') : 'No active Goals. Use /goal to create one.';
      },
      llmAvailable: () => !!this.runtime,
    });
    // 自定义命令：用户级 ~/.mafw/commands/ + 项目级 <project>/.mafw/commands/，热重载
    const registry = this.mafwCommandRegistry;
    const cmdDirs: CommandDir[] = [
      { dir: path.join(this.mafwDir, 'commands'), scope: 'user' },
      { dir: path.join(this.projectDir, '.mafw', 'commands'), scope: 'project' },
    ];
    const execDeps = {
      promptAsync: async (sid: string, text: string) => {
        await this.runtime!.session.promptAsync({ sessionID: sid, parts: [{ type: 'text', text }] });
      },
      ensureManagerSession: async (projectDir: string) => (await this.ensureManagerSession(projectDir, this.mafwDir).catch(() => '')) || '',
      llmAvailable: () => !!this.runtime,
      exec: (cmd: string) => new Promise<string>((resolveExec, rejectExec) => {
        exec(cmd, { cwd: this.projectDir, timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true },
          (err, stdout, stderr) => err ? rejectExec(new Error(stderr?.trim() || err.message)) : resolveExec(stdout.trim()));
      }),
      readFile: async (rel: string) => {
        const full = path.resolve(this.projectDir, rel);
        if (!full.startsWith(path.resolve(this.projectDir))) throw new Error('path escapes project');
        const stat = fs.statSync(full);
        if (stat.size > 100 * 1024) throw new Error('file too large (>100KB)');
        return fs.readFileSync(full, 'utf-8');
      },
    };
    void scanCommandDirs(cmdDirs).then((specs) => {
      registerCustomCommands(registry, specs, execDeps);
      if (specs.length > 0) log.info(`[Commands] 自定义命令已加载: ${specs.map((s) => s.name).join(', ')}`);
      this.discovery?.invalidate();
      void this.discovery?.broadcastKnown('commands_changed').catch((err: any) => log.warn(`[Discovery] command scan broadcast failed: ${err.message}`));
    }).catch(() => { /* fail-open */ });
    this.customCommandWatcherDispose = watchCommandDirs(cmdDirs, (specs) => {
      registerCustomCommands(registry, specs, execDeps);
      log.info(`[Commands] 自定义命令已热重载（${specs.length} 条）`);
      this.broadcast({ type: 'mafw_commands_changed' });
      this.discovery?.invalidate();
      void this.discovery?.broadcastKnown('commands_changed').catch((err: any) => log.warn(`[Discovery] command change broadcast failed: ${err.message}`));
    });
    return this.mafwCommandRegistry;
  }

  private customCommandWatcherDispose: (() => void) | null = null;

  // ── T2-1 checkpoints ──────────────────────────────────────────────────

  /** `git status --porcelain`（checkpoint 的 untracked 快照单一来源；失败返回 ''）。 */
  private async checkpointPorcelainOf(dir: string): Promise<string> {
    const r = await defaultGit.run(['-C', dir, 'status', '--porcelain']);
    return r.code === 0 ? r.stdout : '';
  }

  /** turn.completed → 自动检查点（门控与失败语义见 core/checkpoint/auto-hook.ts）。 */
  private async recordAutoCheckpoint(sessionID: string): Promise<void> {    if (!this.checkpointService) return;
    await runAutoCheckpoint({
      runtime: () => this.runtime,
      access: () => this.runtime?.access ?? null,
      internalRoleOf: (sid) => this.internalSessionRoles.get(sid),
      isHidden: (info, roleFor) => isHiddenSession(info, roleFor),
      porcelainOf: (dir) => this.checkpointPorcelainOf(dir),
      create: (input) => {
        const cp = this.checkpointService.create(input);
        // 只有回合产生了新的快照树，工作区才被重新锚定；纯对话回合（tree=null）
        // 保留上次 files 恢复的工作区基线。
        if (input.snapshotTree !== null) {
          this.getGatewayDb().kvDelete('checkpoint-workspace', input.sessionID);
        }
        return cp;
      },
    }, sessionID);
  }

  // One-off side-question session (user-driven /btw command): create → prompt
  // once → discard. Internal role keeps its output out of T1.
  private async btwAsk(question: string): Promise<string> {
    if (!this.runtime) throw new Error('runtime not available');
    const session = await this.runtime.session.create({ directory: this.resolvedProjectDir() });
    const sessionId = session.id;
    if (!sessionId) throw new Error('Failed to create btw session: no id returned');
    this.registerInternalSession(sessionId, 'btw');
    try {
      const result = await this.runtime.session.prompt({
        sessionID: sessionId,
        parts: [{ type: 'text', text: `[BTW 支线问答] ${question}\n\n（这是一次性支线问答，回答简洁直接，不涉及 goal 编排；答完即弃）` }],
        system: '你是 MAFW 项目的临时助理，回答用户的一个支线问题。简洁、直接、不啰嗦。',
      });
      return (result.parts || [])
        .filter((p: any) => p.type === 'text')
        .map((p: any) => p.text)
        .join('\n') || '';
    } finally {
      await this.runtime.session.delete({ sessionID: sessionId }).catch(() => {});
      this.internalSessionRoles.delete(sessionId);
      this.getGatewayDb().kvDelete('internal-session', sessionId);
    }
  }

  private milestonePush?: MilestonePushNotifier;

  private getMilestonePush(): MilestonePushNotifier | undefined {
    if (!this.runtime) return undefined;
    if (!this.milestonePush) {
      this.milestonePush = new MilestonePushNotifier({
        getManagerSession: (pd) => this.readManagerSessionEntry(pd),
        wasNotified: (key) => !!this.getGatewayDb().kvGet('milestone-notified', key),
        markNotified: (key) => this.getGatewayDb().kvSet('milestone-notified', key, { at: new Date().toISOString() }),
        readGoalState: (goalId, pd) => {
          try {
            const p = path.join(this.mafwDirFor(pd), 'state', `${goalId}.json`);
            if (!fs.existsSync(p)) return null;
            return JSON.parse(fs.readFileSync(p, 'utf-8'));
          } catch { return null; }
        },
        // Hard no-reply: message lands in session history, no LLM run.
        promptNoReply: async (sid, text, key) => {
          // G6 迁移（spec §2 v2 Q3）：notify 型调用走队列交付——busy 边界不丢，幂等键防 watchdog/事件重放双发
          await this.runtime!.session.promptAsync({ sessionID: sid, parts: [{ type: 'text', text }], expectReply: false, delivery: 'queue', ...(key ? { idempotencyKey: key } : {}) });
        },
      });
    }
    return this.milestonePush;
  }

  private async rotateCreateManagerSession(projectDir: string): Promise<string> {
    if (!this.runtime) throw new Error('runtime not available');
    const canonical = canonicalProjectDir(projectDir);
    const session = await this.runtime.session.create({ directory: canonical });
    const sessionId = session.id;
    if (!sessionId) throw new Error('Failed to create lead session: no id returned');
    this.getGatewayDb().kvSet('manager-session', canonical, writeManagerSlot(this.getGatewayDb().kvGet('manager-session', canonical), this.runtimeName, { sessionId, createdAt: new Date().toISOString() }));
    this.registerInternalSession(sessionId, 'lead', resolveIdentityAlias('manager'));
    await this.sdkSession.registerExternal(sessionId, canonical, projectLeadSessionMetadata()).catch(() => {});
    await this.syncPodLead(canonical, sessionId);
    return sessionId;
  }
}

// 鈹€鈹€ 鍏ュ彛 鈹€鈹€

if (require.main === module) {
  const scheduler = new MafwScheduler('.');

  process.on('SIGINT', () => {
    log.info('\n[Scheduler] Received SIGINT, shutting down...');
    void scheduler.shutdown().finally(() => process.exit(0));
  });

  process.on('SIGTERM', () => {
    log.info('\n[Scheduler] Received SIGTERM, shutting down...');
    void scheduler.shutdown().finally(() => process.exit(0));
  });

  scheduler.start().catch(err => {
    log.error('[Scheduler] Fatal error:', (err && (err.stack || err.message)) || err);
    process.exit(1);
  });
}

export { MafwScheduler };




