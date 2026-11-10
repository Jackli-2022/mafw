/**
 * Route attach orchestration (D3 Task 6).
 *
 * `MafwScheduler.startApiServer()` 的 ~41 条 `attach*` 调用整体搬到这里：
 *
 * - **顺序即语义**：registry 按 attach 顺序匹配重叠 pattern（`draft` 静态段先于
 *   `:id`、`attachSessionsCoreRoutes` 先于 read/permissions……），禁止重排。
 * - **lead/pod P2 cargo 逐字保留**：`attachLeadTopicRoutes`（含 `fork:` 闭包）、
 *   `attachAttentionRoutes`、`attachSchedulerRoutes`、`attachLeadBoundaryRoutes`、
 *   `attachPodHandlers`（含 collaboration 表）的闭包体与 env flag 均未改写，
 *   只把 `this.` 换成 deps 访问。
 * - **live getter 纪律**：deps 的每个字段在 kernel 侧都是 getter。attach 时读一次，
 *   闭包每次调用重读——与原先 `this.x` 语义逐字等价。**绝不按值捕获会重赋值的
 *   字段**：attach 早于 runtime 初始化与热切换重赋值，字面量快照会让
 *   `session.fork` 等路由永远拿到 null/旧 capabilities（2026-09-17 回归）。
 * - **循环安全**：只做 type-only deps，不运行时 import kernel/index；本文件位于
 *   `subsystems/`（比 kernel 深一层），懒 `import()` 锚点已由 `./…` 改为 `../…`。
 * - **`__dirname`**：本文件不使用 `__dirname`；需要根路径的 dep 从
 *   `gatewayRoot`（entry 的 `__dirname`）取（Global Constraint）。
 *
 * Spec: docs/superpowers/specs/2026-11-09-gateway-kernel-microkernel-design.md §5.1。
 */
import { config } from '../config';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { eventBus } from '../event-bus';
import { canonicalProjectDir } from '../core/pod/pod-identity';
import { buildPodAttention } from '../core/pod/pod-view';
import { buildLeadGoalStatus } from '../core/lead/goal-status';
import { createGoalIntake, makePodGoalId } from '../core/goal/goal-intake';
import { buildMafwToolFactory } from '../runtime/mafw-tools';
import { projectSessions } from '../runtime/view-projections';
import { SessionListResponse } from '../routes/schemas/session';
import { attachTypedRoute } from '../routes/typed';
import { attachWave1Handlers } from '../routes/wave1-handlers';
import { attachWave2Handlers } from '../routes/wave2-handlers';
import { attachPodHandlers } from '../routes/pod-handlers';
import { attachPodA2ARoutes } from '../routes/pod-a2a';
import { attachLeadTopicRoutes } from '../routes/lead-topics';
import { attachAttentionRoutes } from '../routes/attention';
import { attachSchedulerRoutes } from '../routes/scheduler';
import { attachLeadBoundaryRoutes } from '../routes/lead-boundaries';
import { attachGoalControlRoutes } from '../routes/goal-control';
import { attachGoalRoutes } from '../routes/goals-inline';
import { attachBackgroundJobHandlers } from '../routes/background-jobs';
import { attachCognitionRoutes } from '../routes/cognition';
import { attachPythonRoutes } from '../routes/python';
import { attachToolsRoutes } from '../routes/tools';
import { attachTtsRoutes } from '../routes/tts';
import { attachTerminalRoutes, attachAgentRoutes, attachMobileRoutes } from '../routes/agent-terminal-mobile';
import { attachMediaRoutes } from '../routes/media-upload';
import { attachProjectRoutes } from '../routes/projects';
import { attachMafwCommandRoutes } from '../routes/mafw-commands';
import { attachMergeMemoryRoutes } from '../routes/merge-memory';
import { attachTriageRoutes } from '../routes/triage';
import { attachSkillRoutes } from '../routes/skills';
import { attachApprovalsRoutes } from '../routes/approvals';
import { attachQuestionsPermissionsRoutes } from '../routes/questions-permissions';
import { attachUsageRoutes } from '../routes/usage';
import { attachRecallRoutes } from '../routes/recall';
import { attachAutomationRoutes } from '../routes/automations';
import { attachChatRoutes } from '../routes/chat';
import { attachObsRoutes } from '../routes/obs';
import { attachSessionsCoreRoutes } from '../routes/sessions-core';
import { attachSessionsReadRoutes } from '../routes/sessions-read';
import { attachSessionsPermissionsRoutes } from '../routes/sessions-permissions';
import { attachMemoryRoutes } from '../routes/memory';
import { attachDashboardRoutes } from '../routes/dashboard';
import { attachMiscRoutes } from '../routes/misc';
import { attachConfigRoutes } from '../routes/config';
import { attachRuntimeConfigRoutes } from '../routes/runtime-config';
import { attachEventRoutes } from '../routes/events';
import { normalizeGitHubEvent, normalizeWebhookEvent } from '../core/events/event-normalize';
import type { EventLayerService } from '../core/events/event-layer-service';
import type { EventStore as EventLayerStore } from '../core/events/event-store';
import { attachLlmRoutes } from '../routes/llm';
import { attachMediaPluginRoutes } from '../routes/media-plugins';
import { attachDevicesMobileRoutes } from '../routes/devices-mobile';
import { attachPodsEventsRoutes } from '../routes/pods-events-dispatch';
import { attachMcpMgmtRoutes } from '../routes/mcp-mgmt';
import { attachManagerSessionRoutes } from '../routes/manager-session';
import { attachEventsSseRoutes } from '../routes/events-sse';
import type { RouteRegistry } from '../routes/registry';
import type { BackgroundJobService } from '../core/background/background-jobs';
import type { LeadBoundaryService } from '../core/lead/lead-boundary-service';
import type { LeadTopicStore } from '../core/lead/lead-topic-store';
import type { TopicMessageIndexStore } from '../core/lead/topic-message-index';
import type { LeadTopicResumeService } from '../core/lead/lead-topic-resume-service';
import type { PodAccess } from '../core/pod/pod-access';
import type { PodDirectionService } from '../core/pod/pod-direction-service';
import type { PodGoalService } from '../core/pod/pod-goal-service';
import type { PodMemoryService } from '../core/pod/pod-memory-service';
import type { PodMessageDelivery } from '../core/pod/pod-message-delivery';
import type { PodMessageService } from '../core/pod/pod-message-service';
import type { PodProbeService } from '../core/pod/pod-probe-service';
import type { PodService } from '../core/pod/pod-service';
import type { PodStore } from '../core/pod/pod-store';
import type { PodTaskService } from '../core/pod/pod-task-service';
import type { PodTechLeadService } from '../core/pod/pod-tech-lead-service';
import type { MediaAgent } from '../media/media-agent';
import type { MediaService } from '../media/media-service';
import type { TerminalService } from '../terminal/terminal-service';
import type { MafwCommandRegistry } from '../commands/registry';
import type { PluginLoader } from '../usage/plugin-loader';
import type { TtlMap } from '../concurrency/ttl-map';
import type { createTtsService } from '../media/tts-service';
import type { createCognitionGate } from '../core/cognition/cognition-gate';
import type { InstructionSyncService } from '../core/instructions/instruction-sync-service';
import type { AutomationEngine } from '../automation-engine';
import type { SchedulerLedger } from '../ledger';

// 每个 attach 模块的 deps 契约本身就是"这个字段长什么样"的真相源：索引访问让
// ApiRouteDeps 与消费方保持同步（改 route deps 时这里会 tsc 报警，而不是悄悄放宽）。
type Wave1Deps = Parameters<typeof attachWave1Handlers>[1];
type Wave2Deps = Parameters<typeof attachWave2Handlers>[1];
type PodDeps = Parameters<typeof attachPodHandlers>[1];
type GoalsInlineDeps = Parameters<typeof attachGoalRoutes>[1];
type GoalControlDeps = Parameters<typeof attachGoalControlRoutes>[1];
type SessionsCoreDeps = Parameters<typeof attachSessionsCoreRoutes>[1];
type SessionsPermissionsDeps = Parameters<typeof attachSessionsPermissionsRoutes>[1];
type EventsSseDeps = Parameters<typeof attachEventsSseRoutes>[1];
type MemoryDeps = Parameters<typeof attachMemoryRoutes>[1];
type MiscDeps = Parameters<typeof attachMiscRoutes>[1];
type ObsDeps = Parameters<typeof attachObsRoutes>[1];
type ChatDeps = Parameters<typeof attachChatRoutes>[1];
type DashboardDeps = Parameters<typeof attachDashboardRoutes>[1];
type ApprovalsDeps = Parameters<typeof attachApprovalsRoutes>[1];
type AutomationsDeps = Parameters<typeof attachAutomationRoutes>[1];
type RecallDeps = Parameters<typeof attachRecallRoutes>[1];
type RuntimeConfigDeps = Parameters<typeof attachRuntimeConfigRoutes>[1];
type TtsDeps = Parameters<typeof attachTtsRoutes>[1];
type UsageDeps = Parameters<typeof attachUsageRoutes>[1];
type PythonDeps = Parameters<typeof attachPythonRoutes>[1];
type ManagerSessionDeps = Parameters<typeof attachManagerSessionRoutes>[1];
type DevicesMobileDeps = Parameters<typeof attachDevicesMobileRoutes>[1];
type PodsEventsDeps = Parameters<typeof attachPodsEventsRoutes>[1];
type QuestionsPermissionsDeps = Parameters<typeof attachQuestionsPermissionsRoutes>[1];
type TriageDeps = Parameters<typeof attachTriageRoutes>[1];
type MediaPluginsDeps = Parameters<typeof attachMediaPluginRoutes>[1];

/**
 * The kernel surface the attach block needs, all as **live** reads:
 * 值成员由 kernel 用 getter 组装（见 `MafwScheduler.apiRouteDeps`），
 * `switchingRuntime` / `currentProjectDir` / `fokStatsCache` 是 attach 闭包会写的
 * 字段，因此可读可写。
 */
export interface ApiRouteDeps {
  /** Registry the whole block registers into (attach order = dispatch priority). */
  routeRegistry: RouteRegistry;
  /** `__dirname` of the emitted entry (`dist/`), for root-relative deps (Global Constraint). */
  gatewayRoot: string;

  // ── kernel state (live) ────────────────────────────────────────────────
  runtime: Wave1Deps['runtime'];
  runtimeHost: ReturnType<RuntimeConfigDeps['runtimeHost']>;
  runtimeName: string;
  serveRecovering: boolean;
  serveRunning: ReturnType<DashboardDeps['serveRunning']>;
  serveUrl: ReturnType<QuestionsPermissionsDeps['serveUrl']>;
  switchingRuntime: boolean;
  taskService: Wave1Deps['taskService'];
  sessionConfigService: Wave1Deps['sessionConfig'];
  checkpointService: Wave1Deps['checkpointService'];
  dataPartService: Wave1Deps['dataPartService'];
  runCoordinator: ReturnType<SessionsCoreDeps['runCoordinator']>;
  busySessions: ReturnType<SessionsCoreDeps['busySessions']>;
  leadSessionRegistry: ReturnType<ManagerSessionDeps['leadSessionRegistry']>;
  identityRegistry: ReturnType<MiscDeps['identityRegistry']>;
  identityState: ReturnType<MiscDeps['identityState']>;
  automationEngine: AutomationEngine | undefined;
  ledger: SchedulerLedger | undefined;
  pluginLoader: PluginLoader | null;
  mediaPluginLoader: ReturnType<MediaPluginsDeps['mediaPluginLoader']>;
  backgroundJobs: BackgroundJobService | undefined;
  cognitionGate: ReturnType<typeof createCognitionGate>;
  discovery: Wave1Deps['discovery'];
  instructionSync: InstructionSyncService | undefined;
  internalSessionRoles: ReturnType<ObsDeps['internalSessionRoles']>;
  kernels: ReturnType<PythonDeps['kernels']>;
  activeGoals: ReturnType<DashboardDeps['activeGoals']>;
  fokStatsCache: { at: number; stats: any } | null;
  registeredProjects: Map<string, { projectDir: string; mafwDir: string }>;
  currentProjectDir: string | null;
  projectDir: ReturnType<ChatDeps['projectDir']>;
  mafwDir: ReturnType<GoalsInlineDeps['mafwDir']>;
  recallCalledBySession: ReturnType<RecallDeps['recallCalledBySession']>;
  goalDriverMafwDirCache: ReturnType<GoalsInlineDeps['goalDriverMafwDirCache']>;
  sseClients: ReturnType<EventsSseDeps['sseClients']>;

  // ── services ───────────────────────────────────────────────────────────
  allowlistStore: ReturnType<ApprovalsDeps['allowlistStore']>;
  permissionRules: ReturnType<ApprovalsDeps['permissionRules']>;
  approvalPolicy: ReturnType<SessionsPermissionsDeps['approvalPolicy']>;
  chatSessions: ReturnType<EventsSseDeps['chatSessions']>;
  coactivationGraphStore: ReturnType<MemoryDeps['coactivationGraphStore']>;
  consolidationService: ReturnType<MemoryDeps['consolidationService']>;
  eventStore: ReturnType<EventsSseDeps['eventStore']>;
  goalDriver: ReturnType<GoalsInlineDeps['goalDriver']>;
  heartbeat: ReturnType<MemoryDeps['heartbeat']>;
  leadBoundaries: LeadBoundaryService;
  leadTopics: LeadTopicStore;
  leadTopicIndex: TopicMessageIndexStore;
  leadTopicResume: LeadTopicResumeService;
  mediaAgent: MediaAgent | undefined;
  mediaService: MediaService | undefined;
  memoryService: ReturnType<ChatDeps['memoryService']>;
  pairingService: ReturnType<DevicesMobileDeps['pairingService']>;
  podAccess: PodAccess;
  podDirectionService: PodDirectionService;
  podEventService: ReturnType<PodsEventsDeps['podEventService']>;
  podGoalService: PodGoalService;
  podMemoryService: PodMemoryService;
  podMessageDelivery: PodMessageDelivery;
  podMessageService: PodMessageService;
  podProbeService: PodProbeService;
  podService: PodService;
  podStore: PodStore;
  podTaskService: PodTaskService;
  podTechLeadService: PodTechLeadService;
  pushGateway: ReturnType<DevicesMobileDeps['pushGateway']>;
  sdkSession: ReturnType<SessionsCoreDeps['sdkSession']>;
  sessionQueue: ReturnType<SessionsCoreDeps['sessionQueue']>;
  subagentService: ReturnType<SessionsPermissionsDeps['subagentService']>;
  trajectoryStore: ReturnType<DashboardDeps['trajectoryStore']>;
  ttsInflight: TtlMap<string, Set<AbortController>>;
  ttsRegistry: ReturnType<TtsDeps['ttsRegistry']>;
  ttsService: ReturnType<typeof createTtsService> | undefined;
  usagePoller: ReturnType<UsageDeps['usagePoller']>;
  voiceRuntime: ReturnType<MiscDeps['voiceRuntime']>;

  // ── kernel method bridges (live delegation) ────────────────────────────
  getGatewayDb: GoalsInlineDeps['getGatewayDb'];
  getDiscoveryService: () => Wave1Deps['discovery'];
  rotateDeps: Wave1Deps['rotateDeps'];
  embeddingConfigDeps: Wave1Deps['embeddingConfigDeps'];
  modelConfigDeps: Wave1Deps['modelConfigDeps'];
  usagePluginsDeps: Wave1Deps['usagePluginsDeps'];
  broadcast: Wave1Deps['broadcast'];
  runtimeDeps: Wave2Deps['runtimeDeps'];
  restartAgentDeps: Wave2Deps['restartAgentDeps'];
  pluginHubDeps: Wave2Deps['pluginHubDeps'];
  pluginPackagesDeps: Wave2Deps['pluginPackageDeps'];
  pluginWebDeps: Wave2Deps['pluginWebDeps'];
  conformanceDeps: Wave2Deps['conformanceDeps'];
  dryEventDeps: Wave2Deps['dryEventDeps'];
  buildInstructionBlocks: RecallDeps['buildInstructionBlocks'];
  buildPresence: MiscDeps['buildPresence'];
  capGuard: MiscDeps['capGuard'];
  capGuardQuestion: QuestionsPermissionsDeps['capGuardQuestion'];
  getScanService: ObsDeps['getScanService'];
  getTerminalService: () => TerminalService;
  getMafwCommandRegistry: () => MafwCommandRegistry;
  resolvedProjectDir: MiscDeps['resolvedProjectDir'];
  scheduleSnapshotRefresh: ObsDeps['scheduleSnapshotRefresh'];
  emitQueueUpdated: SessionsCoreDeps['emitQueueUpdated'];
  enqueueQueuedPrompt: SessionsCoreDeps['enqueueQueuedPrompt'];
  attachBudgetGuardForPrompt: SessionsCoreDeps['attachBudgetGuardForPrompt'];
  archiveGoal: GoalControlDeps['archiveGoal'];
  patchState: GoalControlDeps['patchState'];
  destroyAllSessions: GoalControlDeps['destroySessions'];
  pauseGoalControl: (goalId: string) => Promise<void>;
  resumeGoalControl: (goalId: string) => Promise<void>;
  retryGoalControl: (goalId: string, runId?: number) => Promise<void>;
  loadRequest: (goalId: string) => Promise<any>;
  handleValidate: GoalsInlineDeps['handleValidate'];
  handleComplete: GoalsInlineDeps['handleComplete'];
  findGoalStatePath: GoalsInlineDeps['findGoalStatePath'];
  podCost: PodDeps['cost'];
  podTranscript: PodDeps['transcript'];
  podA2AAgent: (podId: string) => any;
  backfillEmbeddings: MemoryDeps['backfillEmbeddings'];
  handleCompress: (observations: string[], model?: string) => Promise<any>;
  handleRuntimeEvent: (evt: any) => void;
  listSessions: (projectID: string | null) => Promise<any[]>;
  skillInstallDeps: TriageDeps['skillInstallDeps'];
  deoptSkill(name: string, reason: string): { deopted: boolean; archivedTo?: string; error?: string };

  // ── P2.4 event layer (live: constructed in initServices, inert when off) ──
  eventLayer?: EventLayerService;
  eventLayerStore?: EventLayerStore;
  processEventThread: (threadId: string) => Promise<void>;
}

export function attachAllRoutes(deps: ApiRouteDeps): void {
  // P5 Wave 1: catalog shadow 登记 + 模块 handler 绑定（一次性，重复 attach 会抛错）。
  // adapter 显式桥接私有成员（结构化类型不认 private）。
  // runtime/runtimeCaps 必须是 getter（活引用）：attach 发生在 startApiServer，
  // 早于 runtime 初始化（441 行）与热切换重赋值——字面量快照会让 session.fork 等
  // 路由永远拿到 null/旧 capabilities（P5 引入的回归，2026-09-17 修复）。
  const gwSelf = deps;
  attachWave1Handlers(deps.routeRegistry, {
    getGatewayDb: () => deps.getGatewayDb(),
    get runtime() { return gwSelf.runtime; },
    automationEngine: deps.automationEngine,
    ledger: deps.ledger,
    rotateDeps: () => deps.rotateDeps(),
    embeddingConfigDeps: () => deps.embeddingConfigDeps(),
    modelConfigDeps: () => deps.modelConfigDeps(),
    usagePluginsDeps: () => deps.usagePluginsDeps(),
    pluginLoader: deps.pluginLoader,
    mediaPluginLoader: deps.mediaPluginLoader,
    broadcast: (e) => deps.broadcast(e),
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
  attachLeadTopicRoutes(deps.routeRegistry, {
    isLeadSession: (sessionID) => !!deps.leadSessionRegistry?.findBySessionId(sessionID),
    projectDirForSession: (sessionID) => deps.leadSessionRegistry?.findBySessionId(sessionID)?.projectDir ?? null,
    topics: deps.leadTopics,
    index: deps.leadTopicIndex,
    goals: (projectDir) => {
      const pod = deps.podStore?.getPodByProject(canonicalProjectDir(projectDir));
      if (!pod) return [];
      const views = deps.podGoalService.views(pod.id);
      return buildLeadGoalStatus(views, buildPodAttention(views));
    },
    workingSetEnabled: () => process.env.MAFW_LEAD_WORKING_SET !== '0',
    listMessages: async ({ sessionID, limit }) => {
      const page: any = await deps.runtime!.session.messages({ sessionID, limit });
      return { data: page?.data ?? [] };
    },
    broadcast: (event) => deps.broadcast(event as any),
    now: () => new Date().toISOString(),
    resume: (topicId) => deps.leadTopicResume.resume(topicId),
    fork: async (topicId, input) => {
      const topic = deps.leadTopics.get(topicId);
      if (!topic) throw Object.assign(new Error('topic not found'), { status: 404 });
      const pod = deps.podStore.getPodByProject(canonicalProjectDir(topic.projectDir));
      if (!pod) throw Object.assign(new Error('pod not found'), { status: 404 });
      const lead = deps.leadSessionRegistry
        ? (deps.leadSessionRegistry.current(topic.projectDir)
          ?? await deps.leadSessionRegistry.ensure(topic.projectDir))
        : null;
      const created = await deps.podTechLeadService.createGoal({
        podId: pod.id,
        projectDir: topic.projectDir,
        title: input.goalTitle || topic.title,
        objective: topic.summary || topic.title,
        createdBy: lead?.sessionId ?? topic.leadSessionId,
        forkFromTopicId: topicId,
      });
      return { goalId: created.goalId, sessionID: created.sessionID };
    },
  });
  attachAttentionRoutes(deps.routeRegistry, {
    views: (projectDir) => {
      const pod = deps.podStore?.getPodByProject(canonicalProjectDir(projectDir));
      return pod ? deps.podGoalService.views(pod.id) : [];
    },
  });
  attachSchedulerRoutes(deps.routeRegistry, {
    status: (projectDir) => {
      const pod = deps.podStore?.getPodByProject(canonicalProjectDir(projectDir));
      return pod ? deps.podGoalService.schedulerStatus(pod.id) : null;
    },
  });
  attachGoalControlRoutes(deps.routeRegistry, {
    hasGoal: (goalId) => !!deps.podStore?.getGoalByGoalId(goalId) || !!deps.findGoalStatePath(goalId),
    terminal: (goalId) => {
      const status = deps.podStore?.getGoalByGoalId(goalId)?.status;
      return status === 'done' || status === 'aborted';
    },
    patchState: (goalId, patch) => deps.patchState(goalId, patch as any),
    pause: (goalId) => deps.pauseGoalControl(goalId),
    resume: (goalId) => deps.resumeGoalControl(goalId),
    destroySessions: (goalId) => deps.destroyAllSessions(goalId),
    archiveGoal: async (goalId, opts) => {
      await deps.archiveGoal(goalId, opts as any);
    },
    retry: (goalId, runId) => deps.retryGoalControl(goalId, runId),
    startGoal: (goalId) => deps.podGoalService.admitReadyGoal(goalId).then(() => undefined),
  });
  attachLeadBoundaryRoutes(deps.routeRegistry, {
    service: deps.leadBoundaries,
    observe: ({ sessionID, text }) => {
      const projectDir = deps.leadSessionRegistry?.findBySessionId(sessionID)?.projectDir;
      if (!projectDir) return null;
      const topic = deps.leadTopics.latestForProject(projectDir);
      if (!topic) return null;
      const pod = deps.podStore?.getPodByProject(canonicalProjectDir(projectDir));
      const goals = pod ? deps.podStore.listGoals(pod.id) : [];
      const goalActive = goals.some((goal) => goal.status === 'active');
      const now = new Date().toISOString();
      const recentWindowMs = 10 * 60_000;
      const goalJustClosed = goals.some((goal) => {
        if (goal.status !== 'done' || !goal.endedAt) return false;
        const ended = Date.parse(goal.endedAt);
        return Number.isFinite(ended) && Date.parse(now) - ended <= recentWindowMs;
      });
      const previousUserText = [...deps.leadTopicIndex.listByTopic(topic.id)]
        .reverse()
        .find((row) => row.role === 'user')?.text;
      return deps.leadBoundaries.observe({
        projectDir,
        leadSessionId: sessionID,
        fromTopicId: topic.id,
        text,
        ...(previousUserText ? { previousUserText } : {}),
        lastActiveAt: topic.lastActiveAt,
        now,
        goalActive,
        goalJustClosed,
      });
    },
  });
  // P2.4 事件层：source / thread / trigger / subscription / delivery + GitHub
  // webhook ingress（HMAC 校验逐字随迁）。禁用时 `enabled()` 返回 false → 503。
  attachEventRoutes(deps.routeRegistry, {
    enabled: () => process.env.MAFW_EVENT_LAYER === '1',
    sources: {
      list: (projectDir) => deps.eventLayer!.listSources(projectDir),
      create: (input: any) => deps.eventLayer!.createSource({
        projectDir: String(input?.projectDir ?? ''),
        kind: input?.kind,
        name: String(input?.name ?? ''),
        config: input?.config && typeof input.config === 'object' ? input.config : {},
      }),
      setEnabled: (id, enabled) => {
        if (!deps.eventLayerStore?.getSource(id)) return false;
        deps.eventLayerStore.setSourceEnabled(id, enabled, new Date().toISOString());
        return true;
      },
    },
    threads: {
      list: (projectDir, sourceId) => deps.eventLayer!.listThreads(projectDir, sourceId),
      triggers: (threadId) => deps.eventLayer!.listTriggers(threadId),
      subscriptions: (threadId) => deps.eventLayer!.listSubscriptions(threadId),
    },
    subscribe: (input: any) => deps.eventLayer!.subscribe({
      threadId: String(input?.threadId ?? ''),
      subscriberType: input?.subscriberType,
      subscriberId: String(input?.subscriberId ?? ''),
      mode: input?.mode,
    }),
    unsubscribe: (id) => deps.eventLayerStore?.removeSubscription(id, new Date().toISOString()) ?? false,
    deliveries: (threadId) => deps.eventLayer!.listDeliveries(threadId),
    webhook: async (sourceId, headers, body: any, rawBody?: string) => {
      const source = deps.eventLayerStore?.getSource(sourceId);
      if (!source) return { accepted: false, status: 404 };
      const secret = typeof source.config.secret === 'string' ? source.config.secret : '';
      if (!secret) return { accepted: false, status: 401 };
      const provided = String(headers['x-hub-signature-256'] ?? '');
      const expected = `sha256=${createHmac('sha256', secret).update(rawBody ?? JSON.stringify(body ?? {})).digest('hex')}`;
      const a = Buffer.from(provided);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        return { accepted: false, status: 401 };
      }
      if (!deps.eventLayer) return { accepted: false, status: 503 };
      const now = new Date().toISOString();
      const deliveryId = String(headers['x-github-delivery'] ?? randomUUID());
      const eventKind = String(headers['x-github-event'] ?? 'webhook');
      let envelope;
      if (source.kind === 'github') {
        const repo = String(body?.repository?.full_name ?? '');
        const number = Number(body?.number ?? body?.pull_request?.number ?? body?.issue?.number ?? 0);
        if (!repo || !Number.isFinite(number) || number <= 0) {
          return { accepted: false, status: 400 };
        }
        envelope = normalizeGitHubEvent({
          projectDir: source.projectDir,
          sourceId: source.id,
          deliveryId,
          event: eventKind,
          action: String(body?.action ?? ''),
          repo,
          number,
          actor: String(body?.sender?.login ?? '') || null,
          payload: body ?? {},
          occurredAt: String(body?.pull_request?.updated_at ?? body?.issue?.updated_at ?? now),
          receivedAt: now,
        });
      } else {
        envelope = normalizeWebhookEvent({
          projectDir: source.projectDir,
          sourceId: source.id,
          deliveryId,
          kind: eventKind,
          actor: String(body?.sender?.login ?? body?.actor ?? '') || null,
          payload: body ?? {},
          occurredAt: String(body?.occurred_at ?? body?.timestamp ?? now),
          receivedAt: now,
        });
      }
      const ingested = deps.eventLayer.ingest(envelope);
      void deps.processEventThread(ingested.thread.id);
      return { accepted: true, duplicate: ingested.duplicate };
    },
  });
  attachWave2Handlers(deps.routeRegistry, {
    runtimeDeps: () => deps.runtimeDeps(),
    restartAgentDeps: () => deps.restartAgentDeps(),
    pluginHubDeps: () => deps.pluginHubDeps(),
    pluginPackageDeps: () => deps.pluginPackagesDeps(),
    pluginWebDeps: () => deps.pluginWebDeps(),
    conformanceDeps: () => deps.conformanceDeps(),
    dryEventDeps: () => deps.dryEventDeps(),
    runtimeSwitchBlocked: () => deps.serveRecovering || deps.switchingRuntime,
    beginRuntimeSwitch: () => { deps.switchingRuntime = true; },
    endRuntimeSwitch: () => { deps.switchingRuntime = false; },
  });
  attachPodHandlers(deps.routeRegistry, {
    pods: deps.podService,
    tasks: deps.podTaskService,
    messages: deps.podMessageService,
    goals: deps.podGoalService,
    memory: deps.podMemoryService,
    access: deps.podAccess,
    delivery: deps.podMessageDelivery,
    intake: {
      create: (input) => createGoalIntake(input, {
        resolveProject: (requested) => {
          const canonical = canonicalProjectDir(requested || deps.resolvedProjectDir());
          const hit = Array.from(deps.registeredProjects.entries())
            .find(([dir]) => canonicalProjectDir(dir) === canonical);
          return hit ? { projectDir: hit[0], mafwDir: hit[1].mafwDir } : null;
        },
        now: () => new Date().toISOString(),
        emitGoalCreated: (event) => eventBus.emit('goal_created', event as any),
      }),
    },
    newGoalId: () => makePodGoalId(new Date().toISOString(), Math.random),
    // Task 18: POST /goals creates a direct discussion Goal via the Tech Lead.
    techLead: deps.podTechLeadService,
    cost: async (podId) => deps.podCost(podId),
    transcript: async (podId, sessionId) => deps.podTranscript(podId, sessionId),
  }, {
    // Task 18: collaboration surface (Tech Lead discussion / direction / probes /
    // reject / revisions). Services are constructed above, so plain references.
    pods: deps.podService,
    goals: deps.podGoalService,
    techLead: deps.podTechLeadService,
    directions: deps.podDirectionService,
    probes: deps.podProbeService,
    revisions: { list: (podId, goalId) => deps.podStore.listGoalRevisions(podId, goalId) },
    revisionStatus: (podId, goalId, revision) => {
      const goal = deps.podStore.getGoal(podId, goalId);
      if (!goal) return null;
      return deps.podStore.getGoalRevision(podId, goalId, revision ?? goal.activeRevision)?.status ?? null;
    },
    startPlanning: (goalId) => deps.podGoalService.admitReadyGoal(goalId).then(() => undefined),
    access: deps.podAccess,
  });

  attachPodA2ARoutes(deps.routeRegistry, {
    getAgent: (podId) => deps.podA2AAgent(podId),
  });
  // Task 3：中性 background jobs façade（三源统一；runtime shell 原生 DTO 不出 gateway）
  attachBackgroundJobHandlers(deps.routeRegistry, () => ({ service: deps.backgroundJobs ?? null }));
  // Phase D1 Task 2：认知面动词迁 registry dispatch（loopback-only 语义随迁）。
  attachCognitionRoutes(deps.routeRegistry, { gate: () => deps.cognitionGate });
  // Phase D1 Task 3a：Python 内核面迁 registry dispatch（loopback-only）。
  attachPythonRoutes(deps.routeRegistry, { kernels: () => deps.kernels });
  // Phase D1 Task 3b：MAFW 工具面迁 registry dispatch（loopback-only）。
  attachToolsRoutes(deps.routeRegistry, {
    buildFactory: () => buildMafwToolFactory({ baseUrl: `http://127.0.0.1:${config.server.apiPort}` }),
    emitEvent: (evt) => deps.handleRuntimeEvent(evt),
  });
  // Phase D1 Task 3c：TTS 面迁 registry dispatch（voices/speak 无 loopback
  // 门、stream/interrupt 有——legacy 语义逐字等价）。
  attachTtsRoutes(deps.routeRegistry, {
    ttsRegistry: () => deps.ttsRegistry,
    ttsReady: () => !!(deps.ttsService && deps.mediaAgent),
    putArtifact: (dataUrl) => deps.mediaAgent!.putArtifact(dataUrl),
    inflight: deps.ttsInflight,
  });
  // Phase D1 Task 3d：agent/terminal/mobile 面迁 registry dispatch。
  attachTerminalRoutes(deps.routeRegistry, {
    getTerminalService: () => deps.getTerminalService(),
    getAccess: () => deps.runtime?.access ?? null,
  });
  attachAgentRoutes(deps.routeRegistry, {
    listOutcomes: (() => deps.getGatewayDb().listGoalOutcomes({ limit: 200 })) as any,
    getIndex: () => deps.memoryService?.harmonicIndex.getIndex() ?? { entries: [] },
  });
  attachMobileRoutes(deps.routeRegistry, {
    getMediaAgent: () => deps.mediaAgent,
    apiToken: () => (config.raw as any)?.server?.apiToken || '',
    loadTtsArtifactHandler: async () => {
      const { createTtsArtifactHandler } = await import('../mobile/tts-artifact.js');
      return createTtsArtifactHandler({ agent: deps.mediaAgent! });
    },
    loadMobileMediaHandler: async () => {
      const { createMobileMediaHandler } = await import('../mobile/media-proxy.js');
      return createMobileMediaHandler({
        agent: deps.mediaAgent!,
        apiToken: (config.raw as any)?.server?.apiToken || '',
      });
    },
  });
  // Phase D1 Task 3e：媒体上传/分析面迁 registry dispatch（4 分支，
  // loopback 门 + 尺寸帽 + chunk 流逐字保留）。
  attachMediaRoutes(deps.routeRegistry, {
    getMediaAgent: () => deps.mediaAgent,
    getMediaService: () => deps.mediaService,
  });
  // Phase D1 Task A1：project 面迁 registry dispatch（2 分支）。
  attachProjectRoutes(deps.routeRegistry, {
    registeredProjects: () => deps.registeredProjects,
    currentProjectDir: () => deps.currentProjectDir,
    setCurrentProjectDir: (dir) => { deps.currentProjectDir = dir; },
    db: () => deps.getGatewayDb(),
  });
  // Phase D1 Task A2：mafw-commands 面迁 registry dispatch（2 分支；409 hold-queue 预检随迁）。
  attachMafwCommandRoutes(deps.routeRegistry, {
    getRegistry: () => deps.getMafwCommandRegistry(),
    registeredProjects: () => deps.registeredProjects,
    projectDir: () => deps.projectDir,
    shouldHoldQueue: (sessionID) => deps.runCoordinator?.shouldHoldQueue(sessionID),
  });
  // Phase D1 Task A3：merge-memory 面迁 registry dispatch（1 分支；动态 import 保留）。
  attachMergeMemoryRoutes(deps.routeRegistry, {
    memory: () => deps.memoryService,
  });
  // Phase D1 Task A4：triage 面迁 registry dispatch（4 分支；confirm 不读 body 原样保留）。
  attachTriageRoutes(deps.routeRegistry, {
    automationEngine: () => deps.automationEngine,
    skillInstallDeps: () => deps.skillInstallDeps(),
    mafwDir: () => deps.mafwDir,
    ledger: () => deps.ledger,
  });
  // Skill v1: deopt is a human/internal action; directory move applies at the
  // next discovery boundary.
  attachSkillRoutes(deps.routeRegistry, {
    deopt: (name, reason) => deps.deoptSkill(name, reason),
  });
  // Phase D1 Task A5：approvals 面迁 registry dispatch（4 分支；数据根扫描路径全保留）。
  attachApprovalsRoutes(deps.routeRegistry, {
    registeredProjects: () => deps.registeredProjects,
    allowlistStore: () => deps.allowlistStore,
    permissionRules: () => deps.permissionRules,
  });
  // Phase D1 Task B1：question / permission 面迁 registry dispatch（5 分支；
  // workspace 重试链与 capGuard 语义逐字保留）。
  attachQuestionsPermissionsRoutes(deps.routeRegistry, {
    capGuard: (res, surface) => deps.capGuard(res, surface),
    capGuardQuestion: (res) => deps.capGuardQuestion(res),
    serveUrl: () => deps.serveUrl,
    currentProjectDir: () => deps.currentProjectDir,
    projectDir: () => deps.projectDir,
    runtime: () => deps.runtime,
    registeredProjects: () => deps.registeredProjects,
    permissionRules: () => deps.permissionRules,
  });
  // Phase D1 Task B2：usage 聚合面迁 registry dispatch（2 分支；fail-open 200 随迁）。
  attachUsageRoutes(deps.routeRegistry, {
    trajectoryStore: () => deps.trajectoryStore,
    usagePoller: () => deps.usagePoller,
  });
  // Phase D1 Task B3/B4：recall 面迁 registry dispatch（instructions/pinned/priors/
  // context；裸 startsWith 收紧为精确段匹配，懒 require 全部保留）。
  attachRecallRoutes(deps.routeRegistry, {
    buildInstructionBlocks: () => deps.buildInstructionBlocks(),
    instructionSync: () => deps.instructionSync ?? null,
    memoryService: () => deps.memoryService,
    recallCalledBySession: () => deps.recallCalledBySession,
    leadSessionRegistry: () => deps.leadSessionRegistry,
    registeredProjects: () => deps.registeredProjects,
    mafwDir: () => deps.mafwDir,
    getGatewayDb: () => deps.getGatewayDb(),
    getScanService: () => deps.getScanService(),
  });
  // Phase D1 Task C1：automation 面迁 registry dispatch（6 分支；draft 静态段
  // 优先于 :id 由 registry 结构保证，legacy 注册序注释语义不变）。
  attachAutomationRoutes(deps.routeRegistry, {
    automationEngine: () => deps.automationEngine,
    ledger: () => deps.ledger,
  });
  // Phase D1 Task C2：chat 面迁 registry dispatch（2 分支；enriched 保留
  // 自有 inline enrichment 副本，不并入 sendEnrichedInternal）。
  attachChatRoutes(deps.routeRegistry, {
    registeredProjects: () => deps.registeredProjects,
    projectDir: () => deps.projectDir,
    runtime: () => deps.runtime,
    shouldHoldQueue: (sessionID) => deps.runCoordinator?.shouldHoldQueue(sessionID),
    memoryService: () => deps.memoryService,
  });
  // Phase D1 Task C3：obs 捕获面迁 registry dispatch（手动 chunked reader、
  // 1MB 静默丢弃、fail-open 200 语义逐字保留）。
  attachObsRoutes(deps.routeRegistry, {
    internalSessionRoles: () => deps.internalSessionRoles,
    getGatewayDb: () => deps.getGatewayDb(),
    getScanService: () => deps.getScanService(),
    scheduleSnapshotRefresh: (sessionID) => deps.scheduleSnapshotRefresh(sessionID),
  });
  // Phase D1 Task D1：sessions core 面迁 registry dispatch（10 分支；deleteLegacy
  // 与 session.delete 的 cleanup 集合不同，R4 各自逐字保留）。
  attachSessionsCoreRoutes(deps.routeRegistry, {
    getGatewayDb: () => deps.getGatewayDb(),
    resolvedProjectDir: () => deps.resolvedProjectDir(),
    sdkSession: () => deps.sdkSession,
    runtime: () => deps.runtime,
    podService: () => deps.podService,
    instructionSync: () => deps.instructionSync,
    discovery: () => deps.discovery,
    trajectoryStore: () => deps.trajectoryStore,
    identityRegistry: () => deps.identityRegistry,
    identityState: () => deps.identityState,
    runCoordinator: () => deps.runCoordinator,
    busySessions: () => deps.busySessions,
    sessionQueue: () => deps.sessionQueue,
    enqueueQueuedPrompt: (opts, source) => deps.enqueueQueuedPrompt(opts, source),
    attachBudgetGuardForPrompt: (sessionID, maxTurns, maxCostUsd) => deps.attachBudgetGuardForPrompt(sessionID, maxTurns, maxCostUsd),
    emitQueueUpdated: (sessionID, kind, items, itemId) => deps.emitQueueUpdated(sessionID, kind, items, itemId),
  });
  // Phase D1 Task E1：sessions 读模型面迁 registry dispatch（5 分支；todo/trajectory/
  // token-summary/children 的 fail-open 200 语义逐字保留）。
  attachSessionsReadRoutes(deps.routeRegistry, {
    runtime: () => deps.runtime,
    trajectoryStore: () => deps.trajectoryStore,
    projectDir: () => deps.projectDir,
    listDataParts: (sessionID, messageIds) => deps.getGatewayDb().listSessionDataParts(sessionID, { messageIds }),
    subagentService: () => deps.subagentService,
  });
  // Phase D1 Task E2：sessions 审批 / 子代理面迁 registry dispatch（7 分支；
  // permission-mode GET/POST method 拆分与 subagents 五操作逐字委托）。
  attachSessionsPermissionsRoutes(deps.routeRegistry, {
    approvalPolicy: () => deps.approvalPolicy,
    runtime: () => deps.runtime,
    permissionRules: () => deps.permissionRules,
    subagentService: () => deps.subagentService,
  });
  // Phase D1 Task F1：memory 查询/统计面迁 registry dispatch（9 分支；sticky 的
  // 503-空壳与 fail-open 200、stats 的 10s fok 缓存直写逐字保留）。
  attachMemoryRoutes(deps.routeRegistry, {
    memoryService: () => deps.memoryService,
    consolidationService: () => deps.consolidationService,
    heartbeat: () => deps.heartbeat,
    coactivationGraphStore: () => deps.coactivationGraphStore,
    fokStatsCache: () => deps.fokStatsCache,
    setFokStatsCache: (value) => { deps.fokStatsCache = value; },
    mafwDir: () => deps.mafwDir,
    getGatewayDb: () => deps.getGatewayDb(),
    backfillEmbeddings: (limit) => deps.backfillEmbeddings(limit),
    searchT1: require('../recall/t1-search').createGatewayT1Search(deps.getGatewayDb()),
  });
  // Phase D1 Task F2：goals inline 面迁 registry dispatch（6 分支 → 7 op；plan /
  // plan-approval 仍以原始 req.url 交给 handleGoalPlan 内部分流）。
  attachGoalRoutes(deps.routeRegistry, {
    mafwDir: () => deps.mafwDir,
    goalDriver: () => deps.goalDriver,
    goalDriverMafwDirCache: () => deps.goalDriverMafwDirCache,
    findGoalStatePath: (goalId) => deps.findGoalStatePath(goalId),
    loadRequest: (goalId) => deps.loadRequest(goalId),
    getGatewayDb: () => deps.getGatewayDb(),
    handleValidate: (goalId, data) => deps.handleValidate(goalId, data),
    handleComplete: (goalId, data) => deps.handleComplete(goalId, data),
  });
  // Phase D1 Task G：dashboard 影子条（goals.list / dashboard.stats /
  // memory.add / memory.setSticky）挂 registry dispatch；handleDashboardAPI
  // 与联合分支整体保留（R5），四个精确 (method, path) 由 registry 先行接管。
  attachDashboardRoutes(deps.routeRegistry, {
    activeGoals: () => deps.activeGoals,
    registeredProjectsSize: () => deps.registeredProjects.size,
    sseClientsSize: () => deps.sseClients.size,
    serveRunning: () => deps.serveRunning,
    trajectoryStore: () => deps.trajectoryStore,
    memoryService: () => deps.memoryService,
  });
  // Phase D1 Task H1：long-tail singles 迁 registry dispatch（voice/presence/
  // eval/orchestration/provider/agents + config GET/PUT + llm/compress +
  // media plugins 对；私有 handleCompress 经 compress 依赖桥接）。
  attachMiscRoutes(deps.routeRegistry, {
    voiceRuntime: () => deps.voiceRuntime,
    buildPresence: () => deps.buildPresence(),
    runtime: () => deps.runtime,
    resolvedProjectDir: () => deps.resolvedProjectDir(),
    getGatewayDb: () => deps.getGatewayDb(),
    capGuard: (res, surface) => deps.capGuard(res, surface),
    identityRegistry: () => deps.identityRegistry,
    identityState: () => deps.identityState,
    runtimeName: () => deps.runtimeName,
  });
  attachConfigRoutes(deps.routeRegistry);
  // Phase D3 Task 2：/api/runtime-config 迁 registry dispatch（catalog 的
  // runtime.config.get/update 幻影条目从此有 handler；runtime / runtimeHost
  // 是 adopt 后可重赋值字段，故收 live getter）。
  attachRuntimeConfigRoutes(deps.routeRegistry, {
    capGuard: (res, surface) => deps.capGuard(res, surface),
    runtime: () => deps.runtime,
    runtimeHost: () => deps.runtimeHost,
  });
  attachLlmRoutes(deps.routeRegistry, {
    compress: (observations, model) => deps.handleCompress(observations, model),
  });
  attachMediaPluginRoutes(deps.routeRegistry, {
    mediaPluginLoader: () => deps.mediaPluginLoader,
  });
  // Phase D1 Task H2：devices / mobile 配对 / pods events / mcp 管理 / manager
  // session / events SSE 迁 registry dispatch（15 条 legacy 分支；handler 体逐字，
  // live getter 注入 pushGateway / pairingService / runtime / podEventService）。
  attachDevicesMobileRoutes(deps.routeRegistry, {
    pushGateway: () => deps.pushGateway,
    pairingService: () => deps.pairingService,
  });
  attachPodsEventsRoutes(deps.routeRegistry, {
    podEventService: () => deps.podEventService,
  });
  attachMcpMgmtRoutes(deps.routeRegistry, {
    runtime: () => deps.runtime,
  });
  attachManagerSessionRoutes(deps.routeRegistry, {
    leadSessionRegistry: () => deps.leadSessionRegistry,
    getGatewayDb: () => deps.getGatewayDb(),
  });
  attachEventsSseRoutes(deps.routeRegistry, {
    chatSessions: () => deps.chatSessions,
    eventStore: () => deps.eventStore,
    sseClients: () => deps.sseClients,
  });
  // code-first P0 试点：schema 是响应事实源，handler 返回数据（不写 res）。
  attachTypedRoute(deps.routeRegistry, {
    operationId: 'session.list',
    response: SessionListResponse,
    handler: async ({ url }) => ({
      sessions: projectSessions(await deps.listSessions(url.searchParams.get('projectID'))),
    }),
  });
}
