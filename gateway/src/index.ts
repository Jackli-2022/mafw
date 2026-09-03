import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import * as https from 'https';
import * as yaml from 'js-yaml';
import { spawn, execSync } from 'child_process';
// import { DashboardServer } from './dashboard/server';
import { config } from "./config";
import { log } from './core/utils/logger';
import { isLoopbackAddr, authorizeRequest, authorizeWsUpgrade } from './core/auth';
import { buildExecutionGraph, FileCheckpointer, planNode, executeNode, reviewNode, syncToDashboard } from './core/langgraph';
import { getActivePolicy } from './orchestration/policy';
import { recordSessionInDb } from './core/engine/phase-orchestrator';

import { McpSSEEndpoint } from "./mcp/sse-transport";
import { ChatSessionManager } from "./chat/chat-sessions";
import { SdkSessionResource } from "./resources/sdk-session";
import { createMemorySearch } from "./interceptors/memory-injector";
import { createToolRegistry } from "./mcp/tool-registry";
import { MemoryService } from "./memory/service";
import { initEmbeddingRuntime, computeDenseScores, getEmbeddingRuntime, setEmbeddingRuntime } from "./memory/embedding-runtime";
import { EmbeddingIndexer } from "./memory/vector-store";
import { onMemoryWritten } from "./memory/harmonic-file-store";
import { GatewayDatabase } from "./memory/gateway-db";
import { TurnPipeline } from "./recall/turn-pipeline";
import { ReflectionPipeline } from "./recall/reflection";
import { MemoryWorker } from "./recall/memory-worker";
import { SessionWorkerPool } from "./recall/session-worker-pool";
import { ReflectCursor } from "./recall/reflect-cursor";
import { IndexScanService, resolveScanBaseUrl } from "./recall/index-scan";
import { ConsolidationService } from "./memory/consolidation-service";
import { getProviderApiKey } from "./runtime/auth";
import { HarmonicUnitFileStore } from "./memory/harmonic-file-store";
import { L5Store } from "./core/memory/l5-store";
import { CostService } from "./cost/service";
import { MediaService } from "./media/media-service";
import { MediaAgent } from "./media/media-agent";
import { createPiPromptAdapter } from "./media/pi-adapter";
import { createMediaRuntimeExecutor, MediaRuntimeExecutor } from "./media/media-runtime-executor";
import { MediaPluginLoader } from "./media/media-plugin-loader";
import { createTtsService } from "./media/tts-service";
import { handleEvalChatCompletion } from "./eval-endpoint";
import { SessionKernels } from "./python/kernel-service";
import { eventBus } from "./event-bus";
import { AutomationEngine, actionRegistry } from "./automation-engine";
import { SchedulerLedger } from "./ledger";
import { DesktopClient } from "./desktop-client";
import { QuestionLedger } from './core/manager/question-ledger';
import { ensureManagerRules } from './core/manager/system-rule-templates';
import { ensureMemoryPipelineRules } from './recall/pipeline-rules';
import { MilestonePushNotifier } from './core/manager/milestone-push';
import { MANAGER_IDENTITY_SYSTEM_PROMPT } from './skills/manager-identity';
import { buildGoalSnapshot } from './core/manager/goal-snapshot';
import { getManagerAgentDefinition } from './skills/manager-agent-config';
import { ensureMemoryCuratorAgent } from './skills/memory-curator-agent';
import { MultiServerMCPClient } from 'langchain-mcp-adapters';
import { WebSocketServer, WebSocket } from 'ws';
import { PushGateway } from './mobile/push-gateway';
import { DeviceStore } from './mobile/device-store';
import { PairingService } from './mobile/pairing';
import { startTray, stopTray } from './tray';
import { startServeSidecar } from './serve-sidecar';
import { startTokenWatcher, readRestartInfo, markRestartNotified } from './self-update';
import {
  StepInjectState,
  shouldConsiderStep,
  selectMemories,
  memoryFingerprint,
  defaultStepInjectOptions,
} from './recall/step-inject';
import { renderMemoryBlocks } from './recall/inject-format';
import { normalizeOpencodeEvent } from './runtime/normalize';
import { RuntimeCapabilities, fullCapabilities, minimalCapabilities, AgentRuntime, RuntimeCredentials } from './runtime/contract';
import { RuntimePluginLoader, createRuntimePluginContext } from './runtime/loader';
import { createPiRuntime, PI_CAPABILITIES } from './runtime/plugins/pi-runtime';
import { handlePermissionReply } from './routes/permission';
import { handleRuntimeGet, handleRuntimeSwitch, handleRuntimeReload } from './routes/runtime-switch';
import { handleRestartAgent } from './routes/restart-agent';
import { handleSessionMutations } from './routes/session-mutations';
import { createServeSupervisor, ServeSupervisor } from './runtime/serve-supervisor';
import { handleMediaSwitch } from './routes/media-switch';

import { handleModelConfigGet, handleModelConfigUpdate, ModelConfigDeps } from './routes/model-config';
import { handleEmbeddingConfigGet, handleEmbeddingConfigUpdate, EmbeddingConfigDeps } from './routes/embedding-config';
import { handleManagerRotate, runManagerRotate, ManagerRotateDeps, ManagerRotateResult } from './routes/manager-rotate';
/**
 * MAFW Scheduler 锟?v5.0 SDK 缂栨帓锟?
 *
 * 鏍稿績璁捐鍘熷垯锟?
 *   - 浣跨敤 @opencode-ai/sdk 绠＄悊 Serve 杩涚▼锟?Session 鐢熷懡鍛ㄦ湡
 *   - 鏃犵姸鎬佷笟鍔″垽锟? 涓嶈锟?waves.json銆佷笉瑙ｆ瀽 review銆佷笉璁＄畻 loop
 *   - 鏂囦欢椹卞姩: 鍙鍙栧凡娉ㄥ唽椤圭洰锟?state/{goalId}.json 锟?nextAction 瀛楁
 *   - 娉ㄥ唽琛ㄦ寔涔呭寲: 鎻掍欢娉ㄥ唽淇℃伅鍐欏叆纾佺洏锛屽穿婧冨悗鍙仮锟?
 *   - 鍐欓槦鍒楅槻骞跺彂: 澶氫釜 /register 鍚屾椂鍒拌揪鏃讹紝鍐欑鐩樹覆琛屽寲
 *   - 鍙仮锟? 宕╂簝閲嶅惎鍚庝粠 state/ 鏂囦欢 + 娉ㄥ唽琛ㄦ仮澶嶆墍鏈夋椿锟?Goal
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

// Kill whatever is listening on `port`. windowsHide is mandatory: execSync
// defaults to a visible console window, so every call here would flash a cmd
// popup (notably during serve crash-recovery). SIGTERM is NOT used: on Windows
// libuv maps SIGTERM to a console CTRL_C broadcast, which makes a process exit
// with 0xC000013A and can trigger recovery loops; hard-kill instead.
function killProcessOnPort(port: number): void {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano | findstr :${port}`, { windowsHide: true }).toString();
      const match = out.match(/LISTENING\s+(\d+)/);
      const pid = match ? Number(match[1]) : null;
      if (pid) process.kill(pid);
    } else {
      const out = execSync(`lsof -ti:${port}`, { windowsHide: true }).toString().trim();
      const pid = Number(out) || null;
      if (pid) process.kill(pid);
    }
  } catch { /* port is free */ }
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

class MafwScheduler {
  private serveInstance?: { url: string; close: () => void };
  private serveUrl: string;
  private apiPort: number;
  private pollInterval: number;
  private projectDir: string;

  // ── Serve sidecar supervision ──
  // serveOwned: this gateway spawned the serve process (exit-event driven).
  // Adopted serves (orphan from a crashed gateway) fall back to a health-poll
  // watchdog because no exit event is available.
  private serveOwned = false;
  private serveExitStreak = 0;
  private serveRecovering = false;
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
  private stopTokenWatcher: (() => void) | null = null;

  // Path 1 step-injection state (mark-before-async + dedup + queue). All
  // per-session entries expire via TtlMap.
  private stepInject = new StepInjectState({
    threshold: config.recall.stepInjectThreshold,
    maxMemories: config.recall.stepInjectMaxMemories,
    intervalMs: config.recall.stepInjectIntervalMs,
    queueCap: config.recall.stepInjectQueueCap,
    ttlMs: config.recall.stepInjectTtlMs,
  });

  // SQLite T1 observation store (single writer = this gateway; the opencode
  // plugin pushes observations via /api/obs/capture). Lazy: constructed after
  // the data-dir migration so it never holds a lock on pre-migration files.
  private gatewayDbInstance: GatewayDatabase | null = null;
  private getGatewayDb(): GatewayDatabase {
    if (!this.gatewayDbInstance) {
      this.gatewayDbInstance = new GatewayDatabase(config.resolvePath(config.recall.obsCapturePath));
    }
    return this.gatewayDbInstance;
  }

  // Memory pipelines (built per run so config hot-reload takes effect).
  private workerPool: SessionWorkerPool | null = null;
  private scanService: IndexScanService | null = null;
  private consolidationService: ConsolidationService | null = null;
  // Internal worker sessions (memory pipelines) — their output must never be
  // captured back into T1 (recursion guard A). Maps sessionID → worker role
  // (manager, turn-compress, index-scan, reflect) for token usage tracking.
  private internalSessionRoles = new Map<string, string>();
  private getReflectCursor(): ReflectCursor {
    return new ReflectCursor(this.getGatewayDb());
  }
  private pipelineRunning = false; // action-level in-flight guard (cron + manual triggers)

  activeGoals = new Map<string, StateFile>();
  registeredProjects = new Map<string, RegisteredProject>();
  private registryPath: string;
  private registryWriteQueue: Promise<void> = Promise.resolve();
  private configPath: string;
  private configWriteQueue: Promise<void> = Promise.resolve();
  private running = true;
  // private dashboard?: DashboardServer;
  private mcpEndpoint?: McpSSEEndpoint;
  private opencodeClient: AgentRuntime | null = null;
  private runtimeCaps: RuntimeCapabilities = minimalCapabilities();
  private runtimeName = 'opencode';
  private runtimeLoader?: RuntimePluginLoader;
  private serveSupervisor: ServeSupervisor;
  private switchingRuntime = false;
  /** Abort controller for the active event stream subscription. Cancelled
   *  before re-subscribing to prevent orphaned async iterator loops. */
  private eventStreamAbort: AbortController | null = null;
  private sseClients: Set<http.ServerResponse> = new Set();
  /** WebSocket clients (mobile app): same events as SSE, JSON frames. */
  private wsClients: Set<WebSocket> = new Set();
  private chatSessions: ChatSessionManager;
  private sdkSession!: SdkSessionResource;
  private memoryService?: MemoryService;
  private mediaService?: MediaService;
  private mediaAgent?: MediaAgent;
  private mediaPluginLoader?: MediaPluginLoader;
  private mediaRuntimeExecutor?: MediaRuntimeExecutor;
  private ttsService?: ReturnType<typeof createTtsService>;
  private kernels?: SessionKernels;
  private automationEngine?: AutomationEngine;
  private ledger?: SchedulerLedger;
  private pushGateway?: PushGateway;
  private pairingService?: PairingService;
  private mdnsAdvertiser?: any; // MdnsAdvertiser
  private mafwDir!: string;
  private trajectoryStore: import('./trajectory/trajectory-store').TrajectoryStore | null = null;
  private anchorGraphStore: import('./graph/anchor-graph-store').AnchorGraphStore | null = null;
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
    this.configPath = config.paths.globalConfig;
    this.registryPath = config.paths.registryFile;
    this.chatSessions = new ChatSessionManager();
    this.serveSupervisor = createServeSupervisor({
      port: config.server.servePort,
      external: !!process.env.MAFW_SERVER_SERVE_URL,
      killPort: (port) => killProcessOnPort(port),
      spawn: async (opts) => {
        const sidecar = await startServeSidecar({
          host: opts.host,
          port: opts.port,
          timeoutMs: opts.timeoutMs,
          onOutput: opts.onOutput,
        });
        return { url: sidecar.url, close: () => sidecar.close() };
      },
      probe: async (url: string) => {
        try {
          const res = await fetch(`${url}/global/health`, { signal: AbortSignal.timeout(3000) } as any);
          return res.ok;
        } catch { return false; }
      },
    });
  }

  get serveRunning(): boolean {
    return !!this.serveInstance;
  }

  /** Check actual serve health via TCP connection, not just object existence. */
  private async checkServeActualHealth(): Promise<boolean> {
    try {
      const url = `${this.serveUrl}/global/health`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(2000),
        headers: { 'User-Agent': 'MAFW-Gateway-HealthCheck' }
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async start() {
    log.info('MAFW Scheduler v5.0 starting...');

    // Single-instance guard: if a healthy gateway already owns apiPort, this
    // instance is redundant — exit before spawning anything (avoids two
    // gateways fighting over ports 3000/4096). In takeover mode (self-update
    // successor) the old process is expected to still hold the port briefly,
    // so wait for it to free before proceeding.
    const takeover = process.env.MAFW_TAKEOVER === '1';
    if (await isPortHealthy(this.apiPort)) {
      if (takeover) {
        log.info('[Scheduler] Takeover mode: waiting for previous gateway to release the port...');
        let freed = false;
        for (let i = 0; i < 30; i++) {
          await this.sleep(1000);
          if (!(await isPortHealthy(this.apiPort))) { freed = true; break; }
        }
        if (!freed) {
          log.error('[Scheduler] Takeover aborted: previous gateway never released the port');
          process.exit(1);
          return;
        }
        log.info('[Scheduler] Port free, taking over');
      } else {
        log.info(`[Scheduler] Another gateway already running on port ${this.apiPort}; exiting`);
        process.exit(0);
        return;
      }
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
    this.setupEventBus();

    // Boot reconcile: orphan questions for inactive goals
    const bootLedger = new QuestionLedger(this.mafwDir);
    const activeCheckpoints = new Set(Array.from(this.activeGoals.keys()));
    bootLedger.bootReconcile(activeCheckpoints);

    // 1. Start HTTP API immediately (health check endpoint, MCP, etc.)
    await this.startApiServer();

    // 2. 初始化 runtime 插件加载器
    this.runtimeLoader = new RuntimePluginLoader(config.resolvePath('runtime-plugins'));
    await this.runtimeLoader.init();
    // 内置插件注册：pi-coding-agent runtime（进程内 SDK 嵌入）
    this.runtimeLoader.registerBuiltin('pi', createPiRuntime, PI_CAPABILITIES, true);

    // 3. 创建 SDK 客户端（auth），用于健康检查和后续通信
    const sdkConfig = {
      baseUrl: this.serveUrl,
      directory: this.projectDir,
      headers: {} as Record<string, string>,
    };
    const opencodePassword = process.env.MAFW_OPENCODE_PASSWORD;
    if (opencodePassword) {
      sdkConfig.headers = { Authorization: 'Basic ' + Buffer.from(`opencode:${opencodePassword}`).toString('base64') };
    }
    const runtime = await this.createRuntime(sdkConfig);
    this.opencodeClient = runtime;
    this.runtimeCaps = runtime.capabilities;
    this.runtimeName = runtime.name;
    this.sdkSession.setClient(this.opencodeClient);
    if (this.trajectoryCollector) {
      this.trajectoryCollector.setOpencodeClient(this.opencodeClient);
    }
    if (this.automationEngine) {
      this.automationEngine.setRuntimeClient(runtime);
    }
    log.info(`Runtime initialized: ${runtime.name} (capabilities: ${JSON.stringify(runtime.capabilities)})`);

    // 3. Background: connect to OpenCode server
    const isExternal = !!runtime.external;
    let serveReady = false;
    if (isExternal) {
      log.info(`[Scheduler] Using external OpenCode Serve at ${this.serveUrl} (runtime.external=true)`);
      try { await this.waitForServeReady(); serveReady = true; }
      catch { log.warn('External OpenCode Serve not available 锟?MCP-only mode'); }
    } else {
      if (await this.isServeHealthy()) {
        log.info('OpenCode Serve already running (adopted; health-poll watchdog)');
        serveReady = true;
        this.serveOwned = false;
        this.startServeWatchdog();
      } else {
        log.info('OpenCode Serve not reachable, checking for stale process...');
        killProcessOnPort(config.server.servePort);
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

    // 5. 鎭㈠閰嶇疆鍜屾敞鍐岃〃
    await this.recoverConfig();
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

    // 5.1 Install the global `manager` primary agent (runtime-neutral definition)
    if (this.runtimeCaps.agentConfigApi && this.opencodeClient?.agents) {
      try {
        await this.opencodeClient.agents.install('manager', getManagerAgentDefinition());
      } catch (err: any) {
        log.warn(`[ManagerAgent] install failed (non-fatal): ${err.message}`);
      }
      // 5.1b Install the `memory-curator` agent for memory pipeline workers
      // (tool-restricted: memory tools only — hard guard against the
      // 2026-08-31 worker-implemented-plans incident)
      try {
        await ensureMemoryCuratorAgent(this.opencodeClient);
      } catch (err: any) {
        log.warn(`[MemoryCurator] install failed (non-fatal): ${err.message}`);
      }
    } else {
      log.warn('[ManagerAgent] agentConfigApi not available — manager agent permission guardrails unavailable');
    }

    // 6. 鎭㈠娲昏穬 Goal
    await this.recoverState();

    // 7. 涓烘墍鏈夊凡娉ㄥ唽椤圭洰鍒濆鍖?Manager session锛堜笉瀛樺湪鍒欒嚜鍔ㄥ垱寤猴級
    for (const [projectDir, info] of this.registeredProjects) {
      try {
        await this.ensureManagerSession(projectDir, info.mafwDir);
      } catch (err: any) {
        log.warn(`[Scheduler] Manager session init failed for ${projectDir}: ${err.message}`);
      }
    }

    // 8. 鍚姩鑷姩鍖栧紩锟?
    if (this.automationEngine) {
      this.automationEngine.start();
      log.info('[Scheduler] Automation engine started');
    }

    // 8.0 Worker-state recovery: reflect sessions that accumulated unreflected
    // episodes while their workers were evicted (fire-and-forget).
    setTimeout(() => this.restoreWorkerState(), 3000);

    // 8. 寮€濮嬭疆璇紙闄嶇骇鍏滃簳锟?
    const pollInterval = config.timeouts.backupPollInterval;
    log.info(`[Scheduler] Starting backup polling loop (${pollInterval / 1000}s)...`);
    this.startBackupPolling();

    // 9. 鐩戝惉 events 鐩綍 (鏇夸唬 HTTP POST /api/events)
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

  // Deterministic: the token writer's session is pinned by handleOpencodeEvent
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
  // recorded caller session first, then every registered project's manager
  // session as fallback. Failures degrade to the passive resume protocol.
  private async notifyUpdateComplete(): Promise<void> {
    const info = readRestartInfo();
    if (!info || info.notified) return;
    const elapsed = info.startedAt ? Math.round((Date.now() - new Date(info.startedAt).getTime()) / 1000) : undefined;
    const message = `[MAFW SYSTEM] Gateway \u81ea\u66f4\u65b0\u5df2\u5b8c\u6210\uff08reason: ${info.reason || '-'}${info.commit ? `, commit: ${info.commit}` : ''}${elapsed !== undefined ? `, \u8017\u65f6 ${elapsed}s` : ''}\uff09\u3002goal \u6267\u884c\u72b6\u6001\u5df2\u6301\u4e45\u5316\uff0c\u8bf7\u8bfb\u53d6 goal state \u7684 nextAction \u5e76\u7ee7\u7eed\u6267\u884c\uff1b\u82e5\u65e0\u672a\u5b8c\u6210\u4efb\u52a1\u5219\u65e0\u9700\u989d\u5916\u52a8\u4f5c\u3002`;

    const targets = new Set<string>();
    if (info.sessionID) targets.add(info.sessionID);
    for (const [pDir] of this.registeredProjects) {
      try {
        const ms = this.getGatewayDb().kvGet<{ sessionId: string }>('manager-session', pDir);
        if (ms?.sessionId) targets.add(ms.sessionId);
      } catch { /* skip */ }
    }

    if (!this.opencodeClient) return;
    let notified = false;
    for (const sid of targets) {
      try {
        await this.opencodeClient.session.promptAsync({
          sessionID: sid,
          parts: [{ type: 'text', text: message }],
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
        // If the runtime plugin section changed, recreate runtime and
        // re-subscribe the event stream (hot-switch, no restart needed).
        if (changed.includes('runtime')) {
          const newPlugin = config.runtime?.plugin;
          if (newPlugin !== prevPlugin) {
            log.info(`[Scheduler] Runtime plugin changed: '${prevPlugin ?? 'builtin'}' → '${newPlugin ?? 'builtin'}'; hot-switching...`);
            try {
              const sdkConfig = {
                baseUrl: this.serveUrl,
                directory: this.projectDir,
                headers: {} as Record<string, string>,
              };
              const opencodePassword = process.env.MAFW_OPENCODE_PASSWORD;
              if (opencodePassword) {
                sdkConfig.headers = { Authorization: 'Basic ' + Buffer.from(`opencode:${opencodePassword}`).toString('base64') };
              }
              const runtime = await this.createRuntime(sdkConfig);
              this.opencodeClient = runtime;
              this.runtimeCaps = runtime.capabilities;
              this.runtimeName = runtime.name;
              this.sdkSession.setClient(this.opencodeClient);
              if (this.trajectoryCollector) this.trajectoryCollector.setOpencodeClient(this.opencodeClient);
              if (this.automationEngine) this.automationEngine.setRuntimeClient(runtime);
              await this.resubscribeEvents(`config hot-reload runtime plugin changed to '${newPlugin ?? 'builtin'}'`);
              log.info(`[Scheduler] Runtime hot-switched to '${runtime.name}'`);
            } catch (err: any) {
              log.warn(`[Scheduler] Runtime hot-switch failed (non-fatal): ${err.message}`);
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
            setImmediate(() => this.onEvent(event.goalId));
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
          this.persistConfig();
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
    if (!this.opencodeClient) {
      log.warn('[Scheduler] opencodeClient not available; skipping event subscription');
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
      // Use /global/event (GlobalEvent = { directory, payload }) so we receive
      // events from ALL workspaces — /event only delivers the current
      // request-scoped workspace, missing sessions in other project dirs.
      const result = await this.opencodeClient.global.event();
      // SDK SSE client returns { stream } where stream is an async generator
      const stream = result?.stream ?? result;
      if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') {
        log.warn('[Scheduler] SDK event subscribe returned no async stream');
        return;
      }
      log.info(`[Scheduler] Subscribed to OpenCode events (runtime=${this.runtimeName})`);
      const signal = controller.signal;
      void (async () => {
        try {
          for await (const evt of stream) {
            if (signal.aborted) break;
            this.handleOpencodeEvent(evt);
          }
          if (!signal.aborted) log.info('[Scheduler] OpenCode event stream ended gracefully');
        } catch (err: any) {
          if (signal.aborted) return; // Expected during hot-switch
          log.warn(`[Scheduler] OpenCode event stream ended: ${err.message}`);
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

  private handleOpencodeEvent(evt: any): void {
    const f = normalizeOpencodeEvent(evt);
    const { type, properties: props, sessionID } = f;
    // Only memory-system sessions (index-scan / extract / reflect workers) are
    // internal: their token-level deltas flooded the desktop renderer (per-delta
    // store writes + re-render storms froze the UI). Tiered policy for them:
    // token noise dropped; lifecycle events (idle/error) still broadcast, tagged
    // `internal`, so the UI can surface pipeline status. Every other session —
    // user chats AND manager goal sessions — passes through untouched.
    const role = sessionID ? this.internalSessionRoles.get(sessionID) : undefined;
    const memoryWorker = !!role && (role === 'index-scan' || role === 'extract' || role === 'reflect');
    if (memoryWorker && type !== 'message.complete' && type !== 'session.idle' && type !== 'message.error' && type !== 'message.aborted' && f.broadcast !== 'error') return;
    // deltas are never logged for any session (per-token lines churned the 5MB log)
    if (type !== 'message.part.delta') log.info(`[SSE] ${this.runtimeName} event: ${type} sessionID=${sessionID}`);

    // Caller-location bookkeeping for self-update: every event refreshes the
    // session's last-active stamp; tool events carrying a shell command that
    // touches the restart token file pin the exact session that wrote it.
    if (sessionID) {
      this.lastActiveBySession.set(sessionID, Date.now());
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
            this.broadcast({ type: 'opencode_event', data: { type: 'trajectory.event', properties: trajEvt, sessionID } });
          }
        }
      }
    } catch (err: any) {
      log.warn(`[Trajectory] handle failed (non-fatal): ${err.message}`);
    }

    // Path 1: settled LLM step → evaluate high-salience memory injection.
    // shouldConsiderStep validates sessionID/assistantMessageID exist and finish is not excluded.
    if (f.step && shouldConsiderStep(f.step)) {
      const { sessionID: sid, assistantMessageID: mid } = f.step;
      if (sid && mid && this.stepInject.markStepSeen(sid, mid)) {
        void this.evaluateStepInjection(sid, mid);
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
    // Normalize to the renderer's contract: { type, properties, sessionID }.
    if (f.broadcast === 'idle') {
      // Path 1: turn fully settled → drain any queued memory injection
      // (delayed to idle so we never collide with the finishing drain).
      if (sessionID) void this.drainStepInjections(sessionID);
      try {
        if (this.trajectoryCollector && sessionID) {
          const turn = this.trajectoryCollector.onIdle(sessionID);
          if (turn) {
            this.broadcast({ type: 'opencode_event', data: { type: 'trajectory.turn', properties: turn, sessionID } });
          }
        }
      } catch (err: any) {
        log.warn(`[Trajectory] idle aggregation failed (non-fatal): ${err.message}`);
      }
      this.broadcast({ type: 'opencode_event', data: { type: 'message.complete', sessionID, ...(memoryWorker ? { internal: true } : {}) } });
    } else if (f.broadcast === 'error') {
      this.broadcast({ type: 'opencode_event', data: { type: 'message.error', sessionID, error: props?.error instanceof Error ? props.error.message : String(props?.error ?? 'Unknown error'), ...(memoryWorker ? { internal: true } : {}) } });
    } else {
      this.broadcast({ type: 'opencode_event', data: { type, properties: props, sessionID, ...(memoryWorker ? { internal: true } : {}) } });
    }
  }

  /** 能力门：runtime 未声明该能力时以 503 显式拒绝（fail-open 的声明式降级）。 */
  private capGuard(res: http.ServerResponse, cap: keyof RuntimeCapabilities): boolean {
    if (this.runtimeCaps[cap]) return false;
    res.writeHead(503);
    res.end(JSON.stringify({ error: `capability '${String(cap)}' not available on runtime '${this.runtimeName}'` }));
    return true;
  }

  /**
   * Runtime 选择：config.runtime.plugin 指定 ~/.mafw/runtime-plugins/ 中的插件；
   * 未配置/找不到/加载失败一律回退内置 opencode（fail-open，行为与现状一致）。
   */
  private async createRuntime(sdkConfig: { baseUrl: string; directory?: string; headers: Record<string, string> }): Promise<AgentRuntime> {
    const pluginName = config.runtime?.plugin;
    if (pluginName) {
      const plugin = this.runtimeLoader?.get(pluginName);
      if (plugin) {
        try {
          const creds = await this.runtimeCredentialsForPlugin();
          const rt = await plugin.createRuntime(createRuntimePluginContext(creds));
          log.info(`[Runtime] using plugin runtime '${rt.name}' (capabilities: ${JSON.stringify(rt.capabilities)})`);
          return rt;
        } catch (err: any) {
          log.warn(`[Runtime] plugin '${pluginName}' createRuntime failed: ${err.message} — falling back to opencode`);
        }
      } else {
        log.warn(`[Runtime] plugin '${pluginName}' not found — falling back to opencode`);
      }
    }
    const { createOpencodeRuntime } = await import('./runtime/opencode-runtime.js');
    return createOpencodeRuntime({
      ...sdkConfig,
      restartServe: async () => {
        await this.serveSupervisor.restart();
      },
    });
  }

  /** 插件 ctx 的凭据来源：当前 opencode runtime 的 credentials（若实现），否则 undefined。 */
  private async runtimeCredentialsForPlugin(): Promise<RuntimeCredentials | undefined> {
    if (this.opencodeClient?.credentials) return this.opencodeClient.credentials;
    return undefined;
  }

  // ── Path 1: step-ended memory injection ────────────────────────────────

  /**
   * Async half of step-ended injection (the seen-mark already happened in
   * handleOpencodeEvent, synchronously). Fetches the turn's last assistant
   * text, searches high-salience memories, dedups by fingerprint, and queues
   * the memory block. Fail-open: any error only logs; nothing is queued.
   */
  private async evaluateStepInjection(sessionID: string, assistantMessageID: string): Promise<void> {
    try {
      if (!this.opencodeClient) return;
      const threshold = config.recall.stepInjectThreshold;
      const maxMemories = config.recall.stepInjectMaxMemories;

      // Query = last assistant text of this turn; no text → no injection
      // (empty-query search returns nothing anyway).
      const result = await this.opencodeClient.session.messages({
        sessionID,
        limit: 20,
      });
      const rawData = result.data || [];
      const assistantMsgs = (Array.isArray(rawData) ? rawData : []).filter(
        (m: any) => m?.info?.role === 'assistant',
      );
      const lastAssistant = assistantMsgs[assistantMsgs.length - 1];
      const texts = (lastAssistant?.parts || [])
        .filter((p: any) => p?.type === 'text' && typeof p?.text === 'string')
        .map((p: any) => p.text);
      const query = texts.join(' ').trim().slice(0, 500);
      if (!query) {
        log.info(`[StepInject] no assistant text for ${sessionID}/${assistantMessageID}; skip`);
        return;
      }

      const entries = this.memoryService?.harmonicIndex.search(query, 8, { retriever: config.search.defaultRetriever }) || [];
      const candidates = entries.map((e: any) => ({
        id: e.id,
        energy: e.energy || 0,
        type: e.type,
        content: e.primary_abstraction || '',
      }));
      const picked = selectMemories(candidates, threshold, maxMemories);
      if (picked.length === 0) return;

      const memIds = picked.map((m) => m.id);
      const fp = memoryFingerprint(memIds);
      if (this.stepInject.fingerprintSeen(sessionID, fp)) {
        log.info(`[StepInject] fingerprint already injected (${fp}); skip`);
        return;
      }

      const blocks = renderMemoryBlocks(picked);
      if (blocks.length === 0) return;
      const block =
        blocks.join('\n\n') +
        '\n\n[记忆] 检测到高价值记忆，请结合记忆内容判断是否需要继续行动；无需行动时仅简短确认。';
      this.stepInject.enqueue(sessionID, { block, memIds, at: Date.now() });
      log.info(`[StepInject] queued ${memIds.length} memories for ${sessionID}`);
    } catch (err: any) {
      log.warn(`[StepInject] evaluate failed (non-fatal): ${err.message}`);
    }
  }

  /**
   * Idle consumer: sends one queued injection per idle. The frequency gate
   * lives inside consume() — if the session injected recently the whole
   * queue is discarded in one shot.
   */
  private async drainStepInjections(sessionID: string): Promise<void> {
    const next = this.stepInject.consume(sessionID);
    if (!next) return;
    try {
      await this.sendStepInjection(sessionID, next.block);
      this.stepInject.markInjected(sessionID, next.memIds, memoryFingerprint(next.memIds));
      log.info(`[StepInject] injected ${next.memIds.length} memories into ${sessionID}`);
    } catch (err: any) {
      // Roll back pushed-memory marks so a failed send never permanently
      // masks those memories from recall injection.
      this.stepInject.rollbackPushed(sessionID, next.memIds);
      log.error(`[StepInject] promptAsync failed for ${sessionID}: ${err.message}`);
    }
  }

  /** promptAsync with a single retry. Never re-injects (raw client channel). */
  private async sendStepInjection(sessionID: string, message: string): Promise<void> {
    if (!this.opencodeClient) throw new Error('opencodeClient not available');
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.opencodeClient.session.promptAsync({ sessionID, parts: [{ type: 'text', text: message }] });
        return;
      } catch (err: any) {
        if (attempt === 0) {
          log.warn(`[StepInject] promptAsync attempt 1 failed, retrying: ${err.message}`);
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        throw err;
      }
    }
  }

  // ── Memory pipelines (turn compress / reflection) ───────────────────────

  private registerInternalSession(sessionId: string, role: string): void {
    this.internalSessionRoles.set(sessionId, role);
    this.getGatewayDb().kvSet('internal-session', sessionId, { role, at: new Date().toISOString() });
  }

  private getPool(): SessionWorkerPool {
    if (!this.workerPool) {
      if (!this.opencodeClient) throw new Error('opencodeClient not available');
      this.workerPool = new SessionWorkerPool({
        client: this.opencodeClient,
        directory: this.projectDir,
        ttlMs: config.recall.sessionWorkerTtlMs,
        compactIdleMs: config.recall.workerCompactIdleMs,
        // Recursion guard (A): internal worker sessions are registered so
        // /api/obs/capture never records their output as observations.
        onSessionCreated: (sessionId, role) => {
          this.registerInternalSession(sessionId, role);
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
    // Judge reuses the worker-model transport; unresolvable → skip path.
    if (config.memory.embedding.consolidation) {
      const providerID = config.recall.workerModel?.providerID;
      const judgeBaseUrl = providerID ? resolveScanBaseUrl(providerID) : undefined;
      const judgeApiKey = judgeBaseUrl ? getProviderApiKey(providerID!) : null;
      this.consolidationService = new ConsolidationService({
        store: new HarmonicUnitFileStore(mafwDir),
        vectors: embeddingRuntime.vectors,
        provider: embeddingRuntime.provider,
        llm: judgeBaseUrl && judgeApiKey
          ? { baseUrl: judgeBaseUrl, apiKey: judgeApiKey, model: config.recall.workerModel.modelID }
          : undefined,
        minCosine: config.memory.embedding.minCosine,
      });
      log.info(`[Consolidation] enabled (judge: ${judgeBaseUrl && judgeApiKey ? providerID : 'unavailable → skip'})`);
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

  private embeddingConfigDeps(): EmbeddingConfigDeps {
    return {
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
        if (!this.opencodeClient) return null;
        const result: any = await this.opencodeClient.provider.list();
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
      }),
      invalidateScanService: () => { this.scanService = null; },
    };
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
          credentials: this.opencodeClient?.credentials
            ? { getApiKey: (p) => this.opencodeClient!.credentials!.getApiKey(p) }
            : undefined,
          baseUrl: (config.recall as any).scanApiUrl || undefined,
        },
      );
      // Initial cache population
      this.scanService.refreshCache();
    }
    return this.scanService;
  }

  /**
   * In-flight guarded pipeline action. AutomationEngine has no serialization
   * (cron fires overlapping ticks; run-automation can trigger manually), so
   * each pipeline runs at most once at a time.
   */
  private async runPipelineGuarded(name: string, fn: () => Promise<void>): Promise<void> {
    if (this.pipelineRunning) {
      log.warn(`[Scheduler] ${name} skipped: previous run still in flight`);
      return;
    }
    this.pipelineRunning = true;
    try {
      await fn();
    } finally {
      this.pipelineRunning = false;
    }
  }

  private registerMemoryPipelineActions(): void {
    actionRegistry.set('memory:turnCompress', async () => {
      await this.runPipelineGuarded('memory:turnCompress', async () => {
        try {
          const pipeline = this.getTurnPipeline();
          const res = await pipeline.runOnce();
          log.info(
            `[TurnPipeline] sessions=${res.sessions} turns=${res.turns} archived=${res.archived} noops=${res.noops} failed=${res.failed}`,
          );
          // Refresh index scan cache after compression (new memories may have been written)
          this.scanService?.refreshCache();
        } catch (err: any) {
          log.warn(`[TurnPipeline] run failed: ${err.message}`);
        }
      });
    });
    actionRegistry.set('memory:reflect', async () => {
      await this.runPipelineGuarded('memory:reflect', async () => {
        try {
          const pipeline = this.getReflectPipeline();
          const res = await pipeline.runAll();
          log.info(
            `[Reflection] sessions=${res.sessions} reviewed=${res.reviewed} distilled=${res.distilled} deduped=${res.deduped} superseded=${res.superseded} failed=${res.failed}`,
          );
        } catch (err: any) {
          log.warn(`[Reflection] run failed: ${err.message}`);
        }
      });
    });
  }

  private getTurnPipeline(): TurnPipeline {
    if (!this.memoryService) throw new Error('memoryService not ready');
    return new TurnPipeline({
      t1db: this.getGatewayDb(),
      index: this.memoryService.harmonicIndex,
      workerFor: (sessionID) => this.getPool().getWorker(sessionID, 'extract'),
      staleMs: config.recall.turnStaleMs,
      workerModel: config.recall.workerModel,
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
    const data = `data: ${JSON.stringify({ ...event, timestamp: new Date().toISOString() })}\n\n`;
    for (const client of this.sseClients) {
      try { client.write(data); } catch { this.sseClients.delete(client); }
    }
    // WebSocket clients receive the same events as JSON frames.
    const frame = JSON.stringify({ ...event, timestamp: new Date().toISOString() });
    for (const ws of this.wsClients) {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(frame); } catch { this.wsClients.delete(ws); }
      }
    }
    // Push to registered mobile devices via PushGateway (online WS + offline fallback)
    this.pushGateway?.onBroadcast(event).catch((err: any) => {
      log.warn(`[PushGateway] broadcast failed: ${err.message}`);
    });
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
    if (!this.opencodeClient) throw new Error('LLM client not available');

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

    const sessionID = existingID || (await this.opencodeClient.session.create({ directory: projectDir })).id;
    if (!sessionID) throw new Error('Failed to create session');
    const promptParts: any[] = [];
    if (enrichedMessage) promptParts.push({ type: 'text', text: enrichedMessage });
    if (Array.isArray(parts) && parts.length > 0) promptParts.push(...parts);
    const promptOpts: any = { sessionID, parts: promptParts };
    if (agent) promptOpts.agent = agent;
    if (model?.providerID && model?.modelID) promptOpts.model = model;
    const result = await this.opencodeClient.session.promptAsync(promptOpts);
    if (result?.error) {
      throw new Error('promptAsync failed: ' + (result.error?.data?.message || result.error?.message || JSON.stringify(result.error)));
    }
    return { sessionID };
  }

  stop() {
    this.running = false;
    this.kernels?.disposeAll();
    this.milestonePush?.dispose();
    // Give an in-flight pipeline a short window to settle before closing the
    // T1 store (closing mid-run would leave turns un-deleted → duplicate
    // extraction on next start), then dispose workers best-effort.
    const settle = new Promise<void>((resolve) => {
      const started = Date.now();
      const check = () => {
        if (!this.pipelineRunning || Date.now() - started > 5000) resolve();
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
    if (this.opencodeClient && typeof (this.opencodeClient as any).dispose === 'function') {
      void (this.opencodeClient as any).dispose().catch((err: any) => {
        log.warn(`[Scheduler] runtime dispose error: ${err?.message ?? String(err)}`);
      });
    }
    this.pushGateway?.destroy();
    this.pairingService?.destroy();
    this.mdnsAdvertiser?.stop();
    // if (this.dashboard) {
    //   this.dashboard.stop();
    // }
    log.info('[Scheduler] Stopping...');
  }

  // Proxy a native opencode request by trying every registered workspace.
  // Native reply/reject routes are workspace-scoped (WorkspaceRoutingMiddleware),
  // but the gateway's own projectDir is its cwd — the request may belong to any
  // registered project. GET list endpoints are cross-workspace and unaffected.
  private async proxyNativeWorkspaces(path: string, method: string, body?: any): Promise<{ ok: boolean; status: number }> {
    const dirs = new Set<string>([this.projectDir || '.']);
    for (const key of this.registeredProjects.keys()) dirs.add(key);
    let lastStatus = 502;
    for (const dir of dirs) {
      try {
        const r = await fetch(`${this.serveUrl}${path}?directory=${encodeURIComponent(dir)}`, {
          method,
          headers: { 'content-type': 'application/json', 'x-opencode-directory': encodeURIComponent(dir) },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        if (r.ok) return { ok: true, status: r.status };
        lastStatus = r.status;
      } catch (e: any) {
        log.error(`[Native proxy] ${path} failed for ${dir}: ${e.message}`);
      }
    }
    return { ok: false, status: lastStatus };
  }

  // 鈹€鈹€ Services & Event Bus 鈹€鈹€

  private async initServices() {
    const projectDir = this.projectDir;
    const mafwDir = config.resolvePath();
    this.mafwDir = mafwDir;

    this.sdkSession = new SdkSessionResource(undefined, mafwDir);
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

    this.mediaPluginLoader = new MediaPluginLoader(path.join(mafwDir, 'media-plugins'), {
      getCredentials: () => this.opencodeClient?.credentials ?? undefined,
    });
    await this.mediaPluginLoader.init();

    this.mediaService = new MediaService({
      prompt: createPiPromptAdapter({
        getApiKey: (provider) => {
          return this.opencodeClient?.credentials?.getApiKey(provider) ?? undefined;
        },
      }),
      config: () => config.raw.media,
      resolvePrompt: (kind, cfg) => {
        const engineName = cfg[kind]?.engine ?? cfg.engine ?? 'pi';
        // pi runtime 激活时：图片走 AgentRuntime 会话（MediaRuntimeExecutor），
        // video/audio 由 executor 内部回退到 complete 路径
        if (engineName === 'pi' && this.opencodeClient?.name === 'pi') {
          if (!this.mediaRuntimeExecutor) {
            this.mediaRuntimeExecutor = createMediaRuntimeExecutor(this.opencodeClient);
          }
          return this.mediaRuntimeExecutor.prompt;
        }
        if (engineName === 'pi') return undefined;
        const engines = this.mediaPluginLoader?.getEngines();
        const engine = engines?.get(engineName);
        if (!engine) {
          log.warn(`[MediaService] engine '${engineName}' not found, falling back to pi`);
          return undefined;
        }
        if (!engine.modalities.includes(kind)) {
          log.warn(`[MediaService] engine '${engineName}' does not support modality '${kind}', falling back to pi`);
          return undefined;
        }
        return engine.prompt;
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
      get credentials() { return self.opencodeClient?.credentials; },
    });
    const pyBin = process.env.MAFW_PYTHON_BIN
      || path.join(os.homedir(), 'AppData', 'Local', 'agent-vision-toolkit', '.venv-pykernel', 'Scripts', 'python.exe');
    this.kernels = new SessionKernels(pyBin);
    const cost = new CostService();
    this.ledger = new SchedulerLedger(projectDir);
    this.automationEngine = new AutomationEngine(mafwDir);
    this.automationEngine.setLedger(this.ledger);
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
    const detectReachableHost = (): string => {
      const ifaces = os.networkInterfaces();
      let lan: string | null = null;
      let tailscale: string | null = null;
      let anyV4: string | null = null;
      for (const [name, addrs] of Object.entries(ifaces)) {
        if (!addrs) continue;
        for (const a of addrs) {
          if (a.family !== 'IPv4' || a.internal) continue;
          if (name.toLowerCase().startsWith('tailscale') || name === 'utun') tailscale = a.address;
          else if (!anyV4) anyV4 = a.address;
          if (!lan && (name.toLowerCase().includes('wlan') || name.toLowerCase().includes('wi-fi') || name.toLowerCase().includes('ethernet') || name.toLowerCase().includes('eth'))) lan = a.address;
        }
      }
      return tailscale || lan || anyV4 || '127.0.0.1';
    };
    const envUrl = process.env.MAFW_MOBILE_TAILSCALE_URL;
    const tailscaleUrl = envUrl || `http://${detectReachableHost()}:${this.apiPort}`;
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
      cost,
      automation: this.automationEngine,
      ledger: this.ledger,
      mafwDir,
      desktop: desktopClient || undefined,
      restartAgent: async () => {
        if (!this.runtimeCaps.agentProcessApi) {
          throw new Error(`Runtime '${this.runtimeName}' does not support agent process restart (agentProcessApi=false)`);
        }
        if (this.serveRecovering) throw new Error('Agent restart already in progress');
        await this.recoverServe();
        return { success: true, mode: 'owned-respawn' };
      },
    };

    const toolRegistry = createToolRegistry();
    this.mcpEndpoint = new McpSSEEndpoint(toolRegistry, services);

    log.info("[Scheduler] Services initialized (Memory + Cost + MCP SSE + Automation)");

    // Trajectory tracking (agent trajectory stats + desktop sidebar)
    try {
      const { TrajectoryStore } = require('./trajectory/trajectory-store');
      const { TrajectoryCollector } = require('./trajectory/collector');
      const trajStore = new TrajectoryStore(this.getGatewayDb(), projectDir);
      this.trajectoryStore = trajStore;
      const collector = new TrajectoryCollector(trajStore, this.getGatewayDb(), projectDir);
      collector.setRoleFor((sid: string) => this.internalSessionRoles.get(sid) ?? null);
      this.trajectoryCollector = collector;
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
      const pluginsDir = path.join(os.homedir(), '.mafw', 'usage-plugins');
      const builtinPluginsDir = path.join(__dirname, 'usage', 'builtin-plugins');
      const disabledPlugins = Array.isArray(config.usage?.disabledPlugins) ? config.usage.disabledPlugins : [];
      const pluginLoader = new PluginLoader(pluginsDir, [], { builtinPluginsDir, disabledPlugins });
      await pluginLoader.init();
      this.pluginLoader = pluginLoader;
      const { UsagePoller } = require('./usage/usage-poller');
      this.usagePoller = new UsagePoller(trajStore, () => config.usage.limits, () => config.usage.budgets, pluginLoader);
      log.info('[Trajectory] store initialized');
    } catch (err: any) {
      log.warn(`[Trajectory] init failed (non-fatal): ${err.message}`);
    }

    // Anchor graph for multi-hop retrieval (SQLite-backed, write-path synced).
    try {
      const { AnchorGraphStore } = require('./graph/anchor-graph-store');
      const anchorStore = new AnchorGraphStore(this.getGatewayDb());
      const index = this.memoryService?.harmonicIndex?.getIndex();
      anchorStore.rebuild(index ?? { entries: [] });
      this.anchorGraphStore = anchorStore;
      this.memoryService?.harmonicIndex?.setAnchorGraphStore(anchorStore);
      log.info('[AnchorGraph] store initialized & rebuilt');
    } catch (err: any) {
      log.warn(`[AnchorGraph] init failed (non-fatal): ${err.message}`);
    }

    const enableLegacy = process.env[config.env.enableLegacyMcp] === "true";
    if (enableLegacy) {
      log.info("[Scheduler] Legacy MCP mode enabled 锟?spawning old MCP Server");
      const { spawn } = require("child_process");
      spawn("node", [path.join(__dirname, "./core/mcp-server.js")], {
        cwd: this.projectDir,
        stdio: "inherit",
      });
    }
  }

  private setupEventBus() {
    eventBus.on("goal_created", (data: any) => {
      this.broadcast({ type: "goal_created", ...data });
      if (data.goalId) setImmediate(() => this.onEvent(data.goalId));
    });
    eventBus.on("state_change", (data: any) => {
      this.broadcast({ type: "state_change", ...data });
      if (data.goalId) setImmediate(() => this.onEvent(data.goalId));
    });
    eventBus.on("user_question", (data: any) => {
      this.broadcast({ type: "user_question", ...data });
    });
    eventBus.on("user_feedback", (data: any) => {
      this.broadcast({ type: "user_feedback", ...data });
    });
    eventBus.on("phase_transition", (data: any) => {
      this.broadcast({ type: "phase_transition", ...data });
      this.getMilestonePush()?.onPhaseTransition(data);
    });
    eventBus.on("memory_written", (data: any) => {
      this.broadcast({ type: "memory_written", ...data });
    });
    eventBus.on("memory_energy_changed", (data: any) => {
      this.broadcast({ type: "memory_energy_changed", ...data });
    });
    eventBus.on("memory_distillation_complete", (data: any) => {
      this.broadcast({ type: "memory_distillation_complete", ...data });
    });
    eventBus.on("automation_triggered", (data: any) => {
      this.broadcast({ type: "automation_triggered", ...data });
    });
    eventBus.on("automation_completed", (data: any) => {
      this.broadcast({ type: "automation_completed", ...data });
    });
  }

  private async startServe() {
    log.info('Starting OpenCode Serve sidecar...');
    const port = config.server.servePort;
    const host = config.server.serveHost;
    try {
      const sidecar = await startServeSidecar({
        host,
        port,
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
  private async restartAgentOrchestrated(): Promise<{ mode: string }> {
    const rt = this.opencodeClient;
    if (rt?.agentProcess) {
      await rt.agentProcess.restart();
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
        failures = 0;
        return;
      }
      failures++;
      log.warn(`[Scheduler] Serve unhealthy (${failures}/${this.serveWatchdogFailures})`);
      if (failures >= this.serveWatchdogFailures) {
        failures = 0;
        if (this.opencodeClient?.external) {
          log.warn('[Scheduler] External serve unreachable; reconnecting event stream only (not killing external process)');
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
    // list: memory-system workers (index-scan / extract / reflect) and
    // Task-tool subagent children (they have a parent session). The role
    // registry covers workers created after its introduction; title patterns
    // catch the pre-registry stragglers (their titles are the first line of
    // the pipeline prompt, e.g. "# Memory Index..." / '{"relevant_ids":...').
    const isHiddenSession = (s: any): boolean => {
      if (s?.parentID) return true;
      const title: string = s?.title || '';
      if (title.startsWith('# Memory Index')) return true;
      // Worker prompts open with raw JSON / fenced JSON / a "标题：" header —
      // their session titles are that first line. Hide the whole family.
      if (title.startsWith('{') || title.startsWith('```') || title.startsWith('标题：')) return true;
      const role = s?.id ? this.internalSessionRoles.get(s.id) : undefined;
      return role === 'index-scan' || role === 'extract' || role === 'reflect';
    };

    // Try SDK first (opencode server), fall back to local store
    const fromServe: any[] = [];
    if (this.opencodeClient) {
      try {
        const result = await this.opencodeClient.session.list(projectID ? { directory: projectID } : undefined);
        const sessions = Array.isArray(result) ? result : [];
        if (sessions && Array.isArray(sessions)) fromServe.push(...sessions);
      } catch {}
    }

    // The serve API's session shape omits parentID, so subagent children that
    // appear in BOTH sources would leak through the serve copy. Collect child
    // ids from the SQLite window first and filter both merge loops by them.
    const childSessionIds = new Set<string>();

    // Merge server-known sessions with the opencode database so sessions that
    // belong to this project but are hidden by serve's project resolution
    // (serve resolves the project to `global` and lists only those) still show
    // up. Server entries win on id collision (fresher in-memory state).
    const merged: any[] = [];
    const seen = new Set<string>();
    try {
      if (projectID && this.opencodeClient) {
        let dbSessions: any[] = [];
        if (this.runtimeCaps.sessionStorageApi && this.opencodeClient.session.listByDirectory) {
          // Effectively unbounded window: memory-worker sessions (index-scan
          // retries etc.) flood the recent head of the table, so any small
          // window filters down to almost nothing. Read the whole project and
          // let the client cap what it renders.
          dbSessions = await this.opencodeClient.session.listByDirectory(projectID, 20000);
        } else {
          const all = await this.opencodeClient.session.list();
          const target = normalizeDir(projectID);
          dbSessions = (Array.isArray(all) ? all : []).filter((s: any) => {
            const d = normalizeDir(s.directory || '');
            return d === target || d.startsWith(target + '/');
          });
        }
        for (const s of dbSessions) {
          if (s?.parentID) childSessionIds.add(s.id);
          if (!seen.has(s.id)) {
            if (isHiddenSession(s)) continue;
            merged.push(s);
            seen.add(s.id);
          }
        }
      }
    } catch {}
    for (const s of fromServe) {
      if (isHiddenSession(s) || (s?.id && childSessionIds.has(s.id))) continue;
      if (s?.id && seen.has(s.id)) {
        // Server state is fresher — replace the SQLite copy in place.
        const idx = merged.findIndex(m => m.id === s.id);
        if (idx >= 0) merged[idx] = s;
        continue;
      }
      merged.push(s);
      if (s?.id) seen.add(s.id);
    }

    if (merged.length > 0) {
      // Enrich sessions with local metadata (manager session markers, etc.).
      const localSessions = await this.sdkSession.list();
      const localMap = new Map(localSessions.map(s => [s.id, s]));
      const enriched = merged.map((s: any) => {
        const local = localMap.get(s.id);
        return local?.metadata ? { ...s, metadata: local.metadata } : s;
      });
      // Also include local-only sessions (e.g. Manager session registered via
      // registerExternal) that the opencode server doesn't know about — but only
      // those belonging to the queried project, so switching projects shows only
      // that project's manager session.
      const sdkIds = new Set<string>(merged.map((s: any) => s.id));
      const missingLocal = localSessions.filter(s => s.metadata && !sdkIds.has(s.id));
      if (missingLocal.length > 0) {
        const targetDir = projectID ? normalizeDir(projectID) : null;
        enriched.push(...missingLocal
          .filter(s => !targetDir || normalizeDir(s.directory || s.projectID || '') === targetDir)
          .map(s => ({
            id: s.id,
            projectID: s.projectID,
            directory: s.directory,
            title: s.title,
            metadata: s.metadata,
            time: s.time,
          })));
      }
      return enriched;
    }

    return projectID ? await this.sdkSession.listByProject(projectID) : await this.sdkSession.list();
  }

  private async isServeHealthy(): Promise<boolean> {
    const url = `${this.serveUrl}/global/health`;
    return new Promise((resolve) => {
      const req = http.get(url, { timeout: 5000 }, (res) => {
        resolve(res.statusCode === 200);
        res.resume();
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
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

  // 鈹€鈹€ 2. HTTP API 鈹€鈹€

  private async startApiServer() {
    return new Promise<void>((resolve) => {
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

        // GET /api/media/resolve-task/<taskId> — resolve taskId to artifactId (for history)
        const resolveTaskMatch = req.url?.match(/^\/api\/media\/resolve-task\/([^/]+)$/);
        if (resolveTaskMatch && req.method === 'GET') {
          if (!isLoopback) { res.writeHead(403); res.end(JSON.stringify({ error: 'forbidden' })); return; }
          try {
            if (!this.mediaAgent) { res.writeHead(503); res.end(JSON.stringify({ error: 'MediaAgent not initialized' })); return; }
            const artifactId = await this.mediaAgent.resolveTaskArtifactId(resolveTaskMatch[1]);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ artifactId: artifactId || null }));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err?.message || String(err) }));
          }
          return;
        }

        // GET /api/tts/voices — preset voice list + model info (desktop picker)
        if (req.url === "/api/tts/voices" && req.method === "GET") {
          try {
            const { TTS_VOICES, TTS_DEFAULT_VOICE, TTS_DEFAULT_MODEL } = await import('./media/tts-service.js');
            const ttsCfg = (config.raw as any)?.media?.tts ?? {};
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              voices: TTS_VOICES,
              models: [
                { id: 'mimo-v2.5-tts', description: '预置音色语音合成（支持唱歌模式）' },
                { id: 'mimo-v2.5-tts-voicedesign', description: '文本描述定制音色' },
                { id: 'mimo-v2.5-tts-voiceclone', description: '音频样本复刻音色' },
              ],
              defaultVoice: ttsCfg.defaultVoice || TTS_DEFAULT_VOICE,
              defaultModel: ttsCfg.model || TTS_DEFAULT_MODEL,
            }));
          } catch (err: any) {
            res.writeHead(502);
            res.end(JSON.stringify({ error: err?.message || String(err) }));
          }
          return;
        }

        // POST /api/tts — MiMo-V2.5-TTS speech synthesis (preset voices, wav)
        if (req.url === "/api/tts" && req.method === "POST") {
          try {
            if (!this.ttsService || !this.mediaAgent) { res.writeHead(503); res.end(JSON.stringify({ error: 'TTS not initialized' })); return; }
            const body = JSON.parse(await readBody(req));
            const text = typeof body?.text === 'string' ? body.text : '';
            if (!text.trim()) { res.writeHead(400); res.end(JSON.stringify({ error: 'text is required' })); return; }
            const voice = typeof body?.voice === 'string' ? body.voice : undefined;
            const style = typeof body?.style === 'string' ? body.style : undefined;
            const result = await this.ttsService.synthesize({ text, voice, style });
            const artifactId = this.mediaAgent.putArtifact(result.audioDataUrl);
            const baseUrl = `http://127.0.0.1:${config.server.apiPort}`;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              artifactId,
              voice: result.voice,
              mime: result.mime,
              url: `${baseUrl}/a2a/artifacts/${artifactId}`,
            }));
          } catch (err: any) {
            res.writeHead(502);
            res.end(JSON.stringify({ error: err?.message || String(err) }));
          }
          return;
        }

        // POST /api/media/analyze-audio — 音频叙述式理解（自然语言：内容 + 情绪/语调轨迹 + 意图）。        // opt-in：只服务实时语音等场景；FLEURS 评测走默认 A2A 路径（不受影响）。
        if (req.url === "/api/media/analyze-audio" && req.method === "POST") {
          if (!isLoopback) { res.writeHead(403); res.end(JSON.stringify({ error: 'forbidden' })); return; }
          try {
            if (!this.mediaService) { res.writeHead(503); res.end(JSON.stringify({ error: 'MediaService not initialized' })); return; }
            const body = JSON.parse(await readBody(req));
            const dataUrl = typeof body?.dataUrl === 'string' ? body.dataUrl : '';
            if (!dataUrl) { res.writeHead(400); res.end(JSON.stringify({ error: 'dataUrl is required' })); return; }
            const mediaType = typeof body?.mediaType === 'string' && body.mediaType ? body.mediaType : 'audio/wav';
            const promptText = typeof body?.prompt === 'string' ? body.prompt : undefined;
            // 叙述式分析（内容 + 情绪/语调轨迹 + 意图，自然语言）；允许自定义 prompt 覆盖。
            const result = promptText
              ? await this.mediaService.analyze(
                  { kind: 'audio', dataUrl, mediaType },
                  promptText,
                )
              : await this.mediaService.analyzeAudioNarrative({ kind: 'audio', dataUrl, mediaType });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ result }));
          } catch (err: any) {
            res.writeHead(502);
            res.end(JSON.stringify({ error: err?.message || String(err) }));
          }
          return;
        }

        // POST /api/media/upload — binary media upload for the A2A media agent.
        // Body is the raw media bytes (octet-stream); the media type rides in
        // the query string. Returns an artifact reference the desktop can pass
        // to /api/media/create-task (the A2A SendMessage then carries only a
        // URL part instead of a huge base64 body).
        const mediaUrlPath = req.url?.split('?')[0]
        if (mediaUrlPath === '/api/media/upload' && req.method === 'POST') {
          if (!isLoopback) { res.writeHead(403); res.end(JSON.stringify({ error: 'forbidden' })); return; }
          try {
            if (!this.mediaAgent) { res.writeHead(503); res.end(JSON.stringify({ error: 'MediaAgent not initialized' })); return; }
            const parsedUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
            const mediaType = parsedUrl.searchParams.get('type') || 'application/octet-stream';
            if (!mediaType.startsWith('image/') && !mediaType.startsWith('video/') && !mediaType.startsWith('audio/')) {
              res.writeHead(415);
              res.end(JSON.stringify({ error: `Unsupported media type: ${mediaType}` }));
              return;
            }
            const chunks: Buffer[] = [];
            let total = 0;
            const cap = mediaType.startsWith('video/') ? 50 * 1024 * 1024 : mediaType.startsWith('audio/') ? 25 * 1024 * 1024 : 20 * 1024 * 1024;
            for await (const chunk of req) {
              total += chunk.length;
              if (total > cap) {
                res.writeHead(413);
                res.end(JSON.stringify({ error: `Media exceeds ${cap} byte limit` }));
                return;
              }
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }
            const bytes = Buffer.concat(chunks);
            if (bytes.length === 0) {
              res.writeHead(400);
              res.end(JSON.stringify({ error: 'empty body' }));
              return;
            }
            const artifactId = this.mediaAgent.putArtifactBytes(bytes, mediaType);
            const baseUrl = `http://127.0.0.1:${config.server.apiPort}`;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              artifactId,
              mediaType,
              size: bytes.length,
              url: `${baseUrl}/a2a/artifacts/${artifactId}`,
            }));
          } catch (err: any) {
            res.writeHead(502);
            res.end(JSON.stringify({ error: err?.message || String(err) }));
          }
          return;
        }

        // POST /api/media/create-task — create an A2A media task from an
        // already-uploaded artifact (URL part reference). Response shape
        // matches the legacy dataUrl createTask path.
        if (req.url === '/api/media/create-task' && req.method === 'POST') {
          if (!isLoopback) { res.writeHead(403); res.end(JSON.stringify({ error: 'forbidden' })); return; }
          try {
            if (!this.mediaAgent) { res.writeHead(503); res.end(JSON.stringify({ error: 'MediaAgent not initialized' })); return; }
            const body = JSON.parse(await readBody(req));
            const artifactId = typeof body?.artifactId === 'string' ? body.artifactId : '';
            const question = typeof body?.question === 'string' ? body.question : '';
            if (!artifactId) { res.writeHead(400); res.end(JSON.stringify({ error: 'artifactId is required' })); return; }
            const mediaType = typeof body?.mediaType === 'string' && body.mediaType ? body.mediaType : this.mediaAgent.getArtifactMediaType(artifactId) || 'application/octet-stream';
            const payload = {
              jsonrpc: '2.0',
              id: 1,
              method: 'SendMessage',
              params: {
                message: {
                  messageId: `fe-${Date.now()}`,
                  role: 1,
                  parts: [
                    { url: `/a2a/artifacts/${artifactId}`, mediaType, filename: 'upload.bin' },
                    ...(question ? [{ text: question }] : []),
                  ],
                },
              },
            };
            const result = await this.mediaAgent.handleJsonRpc(payload, { 'a2a-version': '1.0' });
            const parsed: any = JSON.parse(result.body);
            if (parsed?.error) {
              res.writeHead(result.status);
              res.end(JSON.stringify({ error: parsed.error }));
              return;
            }
            const task = parsed?.result?.task;
            if (!task?.id) {
              res.writeHead(502);
              res.end(JSON.stringify({ error: 'no task returned' }));
              return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ id: task.id, contextId: task.contextId, state: task.status?.state || '' }));
          } catch (err: any) {
            res.writeHead(502);
            res.end(JSON.stringify({ error: err?.message || String(err) }));
          }
          return;
        }

        // POST /api/media/upload-and-create — combined upload + createTask in a
        // single request. Saves one IPC round-trip from the desktop renderer.
        // Body is raw binary (octet-stream); mediaType rides in the query string.
        // Returns immediately with taskID (state=working), model analysis runs async.
        if (req.url?.startsWith('/api/media/upload-and-create') && req.method === 'POST') {
          const t0 = Date.now();
          if (!isLoopback) { res.writeHead(403); res.end(JSON.stringify({ error: 'forbidden' })); return; }
          try {
            if (!this.mediaAgent) { res.writeHead(503); res.end(JSON.stringify({ error: 'MediaAgent not initialized' })); return; }
            const parsedUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
            const mediaType = parsedUrl.searchParams.get('type') || 'application/octet-stream';
            const question = parsedUrl.searchParams.get('question') || '';
            if (!mediaType.startsWith('image/') && !mediaType.startsWith('video/') && !mediaType.startsWith('audio/')) {
              res.writeHead(415);
              res.end(JSON.stringify({ error: `Unsupported media type: ${mediaType}` }));
              return;
            }
            const chunks: Buffer[] = [];
            let total = 0;
            const cap = mediaType.startsWith('video/') ? 50 * 1024 * 1024 : mediaType.startsWith('audio/') ? 25 * 1024 * 1024 : 20 * 1024 * 1024;
            for await (const chunk of req) {
              total += chunk.length;
              if (total > cap) {
                res.writeHead(413);
                res.end(JSON.stringify({ error: `Media exceeds ${cap} byte limit` }));
                return;
              }
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }
            const bytes = Buffer.concat(chunks);
            const t1 = Date.now();
            if (bytes.length === 0) {
              res.writeHead(400);
              res.end(JSON.stringify({ error: 'empty body' }));
              return;
            }
            const artifactId = this.mediaAgent.putArtifactBytes(bytes, mediaType);
            const t2 = Date.now();
            
            // Create task immediately (state=working), analysis runs in background
            const { taskId, contextId } = this.mediaAgent.createTaskAsync(artifactId, mediaType, question);
            const t3 = Date.now();
            
            // Return immediately with taskID (state=working)
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              id: taskId,
              contextId,
              state: 'TASK_STATE_WORKING',
              artifactId,
              mediaType,
              size: bytes.length,
            }));
            const t4 = Date.now();
            log.info(`[upload-and-create] read=${t1-t0}ms artifact=${t2-t1}ms task=${t3-t2}ms respond=${t4-t3}ms total=${t4-t0}ms`);
          } catch (err: any) {
            res.writeHead(502);
            res.end(JSON.stringify({ error: err?.message || String(err) }));
          }
          return;
        }

        // ── Mobile TTS artifact playback (GET /api/mobile/tts/artifacts/:id) ──
        // Token-authed alternative to loopback-only /a2a/artifacts/:id so the
        // mobile app can play synthesized TTS audio over LAN/Tailscale with
        // just_audio + Authorization header (spec §8.3).
        if (req.url?.startsWith('/api/mobile/tts/artifacts/')) {
          try {
            if (!this.mediaAgent) { res.writeHead(503); res.end(JSON.stringify({ error: 'MediaAgent not initialized' })); return; }
            const { createTtsArtifactHandler } = await import('./mobile/tts-artifact.js');
            const ttsArtifactHandler = createTtsArtifactHandler({ agent: this.mediaAgent });
            const handled = await ttsArtifactHandler(req, res);
            if (handled) return;
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err?.message || String(err) }));
            return;
          }
        }

        // ── Mobile media proxy (POST /api/mobile/media/*) ──
        // Simplified endpoints for the Android app: multipart upload → A2A task,
        // and auth-proxy follow-up questions. Delegates to createMobileMediaHandler.
        if (req.url?.startsWith('/api/mobile/media/')) {
          const { createMobileMediaHandler } = await import('./mobile/media-proxy.js');
          const mobileMediaHandler = createMobileMediaHandler({
            agent: this.mediaAgent!,
            apiToken,
          });
          const handled = await mobileMediaHandler(req, res);
          if (handled) return;
        }

        // POST /api/tts/stream — 流式 TTS（SSE，pcm16 24kHz mono 分块）。
        // 每块：data: {"data":"<base64 pcm16>","voice":"<voice>"}\n\n；结束：data: {"done":true}
        if (req.url === "/api/tts/stream" && req.method === "POST") {
          if (!isLoopback) { res.writeHead(403); res.end(JSON.stringify({ error: 'forbidden' })); return; }
          const body = JSON.parse(await readBody(req));
          const text = typeof body?.text === 'string' ? body.text : '';
          if (!text.trim()) { res.writeHead(400); res.end(JSON.stringify({ error: 'text is required' })); return; }
          const voice = typeof body?.voice === 'string' ? body.voice : undefined;
          const style = typeof body?.style === 'string' ? body.style : undefined;
          try {
            if (!this.ttsService) { res.writeHead(503); res.end(JSON.stringify({ error: 'TTS not initialized' })); return; }
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
            });
            const abort = new AbortController();
            req.on('close', () => abort.abort());
            const gen = this.ttsService.synthesizeStream({ text, voice, style }, { signal: abort.signal });
            for await (const chunk of gen) {
              res.write(`data: ${JSON.stringify({ data: chunk.data, voice: chunk.voice })}\n\n`);
            }
            res.write('data: {"done":true}\n\n');
            res.end();
          } catch (err: any) {
            if (!res.headersSent) {
              res.writeHead(502);
              res.end(JSON.stringify({ error: err?.message || String(err) }));
            } else {
              res.write(`data: ${JSON.stringify({ error: err?.message || String(err) })}\n\n`);
              res.end();
            }
          }
          return;
        }

        // POST /api/python/execute — persistent Python kernel (session-scoped)
        if (req.url === "/api/python/execute" && req.method === "POST") {
          if (!isLoopback) { res.writeHead(403); res.end(JSON.stringify({ error: 'forbidden' })); return; }
          try {
            if (!this.kernels) { res.writeHead(503); res.end(JSON.stringify({ error: 'PyKernel not initialized' })); return; }
            const body = JSON.parse(await readBody(req));
            const sessionID = typeof body?.sessionID === 'string' ? body.sessionID : '';
            const code = typeof body?.code === 'string' ? body.code : '';
            if (!sessionID || !code) { res.writeHead(400); res.end(JSON.stringify({ error: 'sessionID and code are required' })); return; }
            const kernel = this.kernels.get(sessionID);
            const result = await kernel.execute(code, {
              timeoutMs: typeof body?.timeoutMs === 'number' ? body.timeoutMs : undefined,
            });
            if (result.truncated) {
              const removed = 'output truncated';
              result.stdout += `\n\n... (${removed}, 已截断)`;
            }
            res.writeHead(200);
            res.end(JSON.stringify(result));
          } catch (err: any) {
            res.writeHead(502);
            res.end(JSON.stringify({ error: err?.message || String(err) }));
          }
          return;
        }

        // POST /api/python/restart — restart the session's kernel (state lost)
        if (req.url === "/api/python/restart" && req.method === "POST") {
          if (!isLoopback) { res.writeHead(403); res.end(JSON.stringify({ error: 'forbidden' })); return; }
          try {
            if (!this.kernels) { res.writeHead(503); res.end(JSON.stringify({ error: 'PyKernel not initialized' })); return; }
            const body = JSON.parse(await readBody(req));
            const sessionID = typeof body?.sessionID === 'string' ? body.sessionID : '';
            if (!sessionID) { res.writeHead(400); res.end(JSON.stringify({ error: 'sessionID is required' })); return; }
            await this.kernels.restart(sessionID);
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true }));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err?.message || String(err) }));
          }
          return;
        }

        // GET /api/python/status — kernel status for a session
        if (req.url === "/api/python/status" && req.method === "GET") {
          if (!isLoopback) { res.writeHead(403); res.end(JSON.stringify({ error: 'forbidden' })); return; }
          try {
            if (!this.kernels) { res.writeHead(503); res.end(JSON.stringify({ error: 'PyKernel not initialized' })); return; }
            const sessionID = new URL(req.url, 'http://localhost').searchParams.get('sessionID') || '';
            if (!sessionID) { res.writeHead(400); res.end(JSON.stringify({ error: 'sessionID is required' })); return; }
            res.writeHead(200);
            res.end(JSON.stringify(this.kernels.status(sessionID)));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err?.message || String(err) }));
          }
          return;
        }

        // MCP SSE session establishment
        if (req.url === "/mcp" && req.method === "GET") {
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

        // MCP client messages
        if (req.url?.startsWith("/mcp") && req.method === "POST") {
          try {
            await this.mcpEndpoint!.handleMessage(req, res);
          } catch (err: any) {
            log.error("[MCP Message] Error:", err.message);
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

        // Chat API 锟?fire-and-forget promptAsync, returns sessionID for SSE streaming
        if (req.url === "/api/chat" && req.method === "POST") {
          try {
            const body = await readBody(req);
            const { message } = JSON.parse(body);
            if (!message) { res.writeHead(400); res.end(JSON.stringify({ error: 'message required' })); return; }

            const firstProject = this.registeredProjects.values().next().value;
            const projectDir = firstProject?.projectDir || this.projectDir;

            if (!this.opencodeClient) {
              res.writeHead(503); res.end(JSON.stringify({ error: 'LLM client not available' })); return;
            }

            const session = await this.opencodeClient.session.create({ directory: projectDir });
            const sessionID = session.id;
            if (!sessionID) {
              res.writeHead(500); res.end(JSON.stringify({ error: 'Failed to create session' })); return;
            }

            const result = await this.opencodeClient.session.promptAsync({
              sessionID,
              parts: [{ type: 'text', text: message }],
            });
            if (result?.error) {
              log.warn(`[Scheduler] promptAsync failed for ${sessionID}: ${JSON.stringify(result.error)}`);
              res.writeHead(500);
              res.end(JSON.stringify({ error: 'promptAsync failed: ' + (result.error?.data?.message || result.error?.message || JSON.stringify(result.error)) }));
              return;
            }
            log.info(`[Scheduler] promptAsync ok session=${sessionID} status=${result?.response?.status}`);

            res.writeHead(200);
            res.end(JSON.stringify({ sessionID }));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // POST /api/chat/enriched 锟?chat with memory context injection
        if (req.url === "/api/chat/enriched" && req.method === "POST") {
          try {
            const body = await readBody(req);
            const { message, sessionID: existingID, parts, agent, model } = JSON.parse(body);
            if (!message && !Array.isArray(parts)) { res.writeHead(400); res.end(JSON.stringify({ error: 'message or parts required' })); return; }

            const firstProject = this.registeredProjects.values().next().value;
            const projectDir = firstProject?.projectDir || this.projectDir;

            if (!this.opencodeClient) {
              res.writeHead(503); res.end(JSON.stringify({ error: 'LLM client not available' })); return;
            }

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

    const sessionID = existingID || (await this.opencodeClient.session.create({ directory: projectDir })).id;
            if (!sessionID) {
              res.writeHead(500); res.end(JSON.stringify({ error: 'Failed to create session' })); return;
            }
            // Extra parts (file/agent attachments) ride along after the enriched text.
            const promptParts: any[] = [];
            if (enrichedMessage) promptParts.push({ type: 'text', text: enrichedMessage });
            if (Array.isArray(parts) && parts.length > 0) promptParts.push(...parts);
            const promptOpts: any = { sessionID, parts: promptParts };
            if (agent) promptOpts.agent = agent;
            if (model?.providerID && model?.modelID) promptOpts.model = model;
            const result = await this.opencodeClient.session.promptAsync(promptOpts);
            if (result?.error) {
              log.warn(`[Scheduler] promptAsync failed for ${sessionID}: ${JSON.stringify(result.error)}`);
              res.writeHead(500);
              res.end(JSON.stringify({ error: 'promptAsync failed: ' + (result.error?.data?.message || result.error?.message || JSON.stringify(result.error)) }));
              return;
            }
            log.info(`[Scheduler] promptAsync ok session=${sessionID} status=${result?.response?.status}`);

            res.writeHead(200);
            res.end(JSON.stringify({ sessionID }));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // POST /api/mafw-commands/run — native MAFW commands from the desktop
        // slash panel (/goal, /status, /merge-memory). Kept out of the MCP
        // registry because these are UI-driven, not LLM-driven.
        if (req.url === "/api/mafw-commands/run" && req.method === "POST") {
          try {
            const body = await readBody(req);
            const { command, args, sessionID } = JSON.parse(body);
            const cmd = String(command || "").trim().toLowerCase();
            const argStr = String(args || "").trim();
            const firstProject = this.registeredProjects.values().next().value;
            const projectDir = firstProject?.projectDir || this.projectDir;

            if (cmd === "goal") {
              if (!argStr) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: "goal description required" })); return; }
              const manager = await this.ensureManagerSession(projectDir, this.mafwDir).catch(() => "");
              const target = manager || (await this.opencodeClient?.session.create({ directory: projectDir }))?.id;
              if (!target || !this.opencodeClient) {
                res.writeHead(503); res.end(JSON.stringify({ ok: false, error: "LLM client not available" })); return;
              }
              const message = `创建新 Goal：${argStr}`;
              await this.opencodeClient.session.promptAsync({ sessionID: target, parts: [{ type: "text", text: message }] });
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true, message: `Goal 已提交：${argStr}`, sessionID: target }));
              return;
            }

            if (cmd === "status") {
              const statusPath = path.join(this.mafwDir, 'STATUS.md');
              const text = fs.existsSync(statusPath) ? fs.readFileSync(statusPath, 'utf-8') : 'No active Goals. Use /goal to create one.';
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true, text }));
              return;
            }

            if (cmd === "merge-memory") {
              const parts = argStr.split(/\s+/);
              const sourceWorktree = parts[0];
              if (!sourceWorktree) {
                res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'Usage: /merge-memory <sourceWorktreePath> [strategy]' })); return;
              }
              const { handleMergeMemory } = await import('./mcp/handlers/merge-memory.js');
              const result = await handleMergeMemory({ sourceWorktree, resolveStrategy: parts[1] || 'manual' } as any, {
                memory: this.memoryService,
              } as any);
              const text = result.content?.[0]?.text || '{}';
              let parsed: any;
              try { parsed = JSON.parse(text) } catch { parsed = { text } }
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: parsed.success !== false, ...parsed }));
              return;
            }

            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: `Unknown command: ${cmd}` }));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ ok: false, error: err.message }));
          }
          return;
        }
        // POST /api/merge-memory — direct merge endpoint used by the plugin
        // /merge-memory slash command (src/plugin.ts). Reuses the MCP handler.
        if (req.url === "/api/merge-memory" && req.method === "POST") {
          try {
            const body = await readBody(req);
            const { sourceWorktree, strategy, resolveStrategy } = JSON.parse(body);
            if (!sourceWorktree) {
              res.writeHead(400);
              res.end(JSON.stringify({ ok: false, error: 'sourceWorktree is required' }));
              return;
            }
            const { handleMergeMemory } = await import('./mcp/handlers/merge-memory.js');
            const result = await handleMergeMemory(
              { sourceWorktree, resolveStrategy: strategy || resolveStrategy || 'manual' } as any,
              { memory: this.memoryService } as any,
            );
            const text = result.content?.[0]?.text || '{}';
            let parsed: any;
            try { parsed = JSON.parse(text) } catch { parsed = { text } }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: parsed.success !== false, ...parsed }));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ ok: false, error: err.message }));
          }
          return;
        }

// GET /api/memory/merged-search 锟?expose memory context injection results
        if (req.url === "/api/memory/merged-search" && req.method === "GET") {
          try {
            const parsedUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
            const query = parsedUrl.searchParams.get('query') || '';
            const maxFacts = parseInt(parsedUrl.searchParams.get('maxFacts') || '5', 10);
            if (!this.memoryService) {
              res.writeHead(503); res.end(JSON.stringify({ error: 'Memory service not available' })); return;
            }
            const results = await this.memoryService.mergedSearch(query, maxFacts);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ results }));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // POST /api/memory/embeddings/backfill — index entries missing vectors.
        // Optional ?limit=N to batch (full store ≈ 12s for short abstractions).
        if (req.url?.match(/^\/api\/memory\/embeddings\/backfill(?:\?|$)/) && req.method === 'POST') {
          try {
            const parsedUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
            const limit = parseInt(parsedUrl.searchParams.get('limit') || '', 10);
            const result = await this.backfillEmbeddings(!Number.isNaN(limit) && limit > 0 ? limit : undefined);
            if (!result) {
              res.writeHead(400); res.end(JSON.stringify({ error: 'embedding provider off (memory.embedding.provider)' })); return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // GET/POST /api/memory/embedding-config — memory embedding engine
        // settings (hot-swap: rebuild runtime + background backfill). MUST
        // stay above the /api/memory/* dashboard delegation below.
        if (req.url?.match(/^\/api\/memory\/embedding-config(?:\?|$)/) && req.method === 'GET') {
          await handleEmbeddingConfigGet(req, res, this.embeddingConfigDeps());
          return;
        }
        if (req.url?.match(/^\/api\/memory\/embedding-config(?:\?|$)/) && req.method === 'POST') {
          await handleEmbeddingConfigUpdate(req, res, this.embeddingConfigDeps());
          return;
        }

        // GET /api/memory/stats — consolidation health + vector coverage (P2)
        if (req.url?.match(/^\/api\/memory\/stats(?:\?|$)/) && req.method === 'GET') {
          try {
            const embeddingRuntime = getEmbeddingRuntime();
            const consolidation = this.consolidationService?.getStats() ?? null;
            const indexEntries = this.memoryService?.harmonicIndex.getIndex().entries ?? [];
            const indexed = embeddingRuntime ? embeddingRuntime.vectors.size() : 0;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              embedding: {
                provider: config.memory.embedding.provider,
                model: config.memory.embedding.model,
                vectors: indexed,
                indexEntries: indexEntries.length,
                coverage: indexEntries.length > 0 ? indexed / indexEntries.length : 0,
              },
              consolidation,
            }));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // GET /api/memory/search — harmonic index search; empty query lists all entries
        if (req.url?.match(/^\/api\/memory\/search(?:\?|$)/) && req.method === 'GET') {
          try {
            if (!this.memoryService) {
              res.writeHead(503); res.end(JSON.stringify({ error: 'Memory service not available' })); return;
            }
            const parsedUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
            const query = parsedUrl.searchParams.get('query') || '';
            const topK = parseInt(parsedUrl.searchParams.get('topK') || '50', 10);
            const retrieverParam = parsedUrl.searchParams.get('retriever');
            const store = new HarmonicUnitFileStore(this.mafwDir);
            const index = store.indexManager_();
            let entries;
            if (query && retrieverParam === 'hybrid') {
              const dense = await computeDenseScores(query, topK, index);
              entries = index.search(query, topK, dense ? { retriever: 'bm25', denseScores: dense } : { retriever: 'bm25' });
            } else if (query) {
              const retriever = retrieverParam === 'bm25' ? 'bm25' : 'token';
              entries = index.search(query, topK, { retriever });
            } else {
              entries = [...index.getIndex().entries]
                  .sort((a, b) => b.energy - a.energy)
                  .slice(0, topK);
            }
            const results: any[] = [];
            for (const entry of entries) {
              const unit = await store.read(entry.id);
              if (unit) {
                results.push(unit);
              } else {
                results.push({
                  id: entry.id,
                  type: entry.type,
                  primary_abstraction: entry.primary_abstraction,
                  cue_anchors: entry.cue_anchors,
                  memory_value: '',
                  energy: entry.energy,
                  tier: entry.tier,
                });
              }
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ results }));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // DELETE /api/memory/{id} — physically remove OKF file + index entry
        const memoryDeleteMatch = req.url?.match(/^\/api\/memory\/([^/]+)$/);
        if (memoryDeleteMatch && req.method === 'DELETE') {
          try {
            const store = new HarmonicUnitFileStore(this.mafwDir);
            const removed = await store.delete(memoryDeleteMatch[1]);
            if (removed && this.memoryService) {
              this.memoryService.harmonicIndex.removeEntry(memoryDeleteMatch[1]);
            }
            res.writeHead(removed ? 200 : 404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(removed ? { status: 'deleted' } : { error: 'Not found' }));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // GET /api/memory/energy-distribution — bucket index entries by energy
        if (req.url === "/api/memory/energy-distribution" && req.method === "GET") {
          try {
            if (!this.memoryService) {
              res.writeHead(503); res.end(JSON.stringify({ error: 'Memory service not available' })); return;
            }
            const entries = new HarmonicUnitFileStore(this.mafwDir).indexManager_().getIndex().entries;
            const dist = { critical: 0, high: 0, medium: 0, low: 0, total: entries.length };
            for (const e of entries) {
              if (e.energy >= 0.8) dist.critical++;
              else if (e.energy >= 0.6) dist.high++;
              else if (e.energy >= 0.4) dist.medium++;
              else dist.low++;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(dist));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // GET /api/l5/axioms — global L5 axioms + heuristics
        if (req.url?.match(/^\/api\/l5\/axioms(?:\?|$)/) && req.method === 'GET') {
          try {
            const parsedUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
            const topK = parseInt(parsedUrl.searchParams.get('topK') || '10', 10);
            const { axioms, heuristics } = new L5Store().getTop(topK);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ axioms, heuristics }));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // POST /api/goals/{goalId}/questions/{questionId}/respond
        const respondMatch = req.url?.match(/^\/api\/goals\/([^/]+)\/questions\/([^/]+)\/respond$/);
        if (respondMatch && req.method === 'POST') {
          const goalId = respondMatch[1];
          const questionId = respondMatch[2];
          const body = await readBody(req);
          let data: any;
          try { data = JSON.parse(body); } catch {
            res.writeHead(400);
            res.end(JSON.stringify({ status: 'bad_request', error: 'Invalid JSON' }));
            return;
          }
          const ledger = new QuestionLedger(this.mafwDir);
          const state = ledger.getQuestionState(questionId);
          if (!state) {
            res.writeHead(404);
            res.end(JSON.stringify({ status: 'not_found' }));
            return;
          }
          if (state !== 'pending') {
            res.writeHead(409);
            res.end(JSON.stringify({ status: 'conflict', currentState: state }));
            return;
          }
          if (data.type === 'cancel') {
            ledger.appendQuestionEvent({
              type: 'cancelled', questionId, goalId, cancelledAt: new Date().toISOString(),
            });
            eventBus.emit('question_cancelled', { questionId, goalId });
            res.writeHead(200);
            res.end(JSON.stringify({ status: 'accepted', action: 'cancelled' }));
            return;
          }
          // answer or redirect
          ledger.appendQuestionEvent({
            type: 'answered', questionId, goalId,
            answer: data.answer || '', answeredAt: new Date().toISOString(),
          });
          // Resume graph
          const found = this.findGoalStatePath(goalId);
          if (found) {
            const cp = new FileCheckpointer(found.info.mafwDir);
            const graph = buildExecutionGraph(this.buildNodeOptions(found.info.mafwDir));
            graph.checkpointer = cp;
            const { Command } = await import('@langchain/langgraph');
            await graph.invoke(new Command({ resume: { answer: data.answer || '' } }) as any, {
              configurable: { thread_id: goalId },
            });
          }
          eventBus.emit('question_answered', { questionId, goalId, answer: data.answer });
          res.writeHead(200);
          res.end(JSON.stringify({ status: 'accepted' }));
          return;
        }

        // Dashboard API
        if (req.url?.startsWith("/api/goals") || req.url?.startsWith("/api/stats") || req.url?.startsWith("/api/memory")) {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(await this.handleDashboardAPI(req)));
          return;
        }

        // POST /api/eval/chat/completions — EvalScope adapter: OpenAI-compatible
        // endpoint that drives a full main-agent run (media → agent → A2A →
        // MediaAgent → multimodal model) and returns the final answer.
        if (req.url?.match(/^\/api\/eval\/chat\/completions(?:\?|$)/) && req.method === 'POST') {
          try {
            const body = JSON.parse(await readBody(req));
            const evalHandler = handleEvalChatCompletion({
              opencodeClient: this.opencodeClient,
              directory: this.projectDir,
              providerID: 'opencode-go',
              modelID: 'deepseek-v4-flash',
              timeoutMs: 300_000,
            });
            const result = await evalHandler(body);
            res.setHeader("Content-Type", "application/json");
            res.writeHead(result.status);
            res.end(JSON.stringify(result.body));
          } catch (err: any) {
            log.error(`[Eval] chat error: ${err.message}`);
            res.writeHead(400);
            res.end(JSON.stringify({ error: { message: err.message } }));
          }
          return;
        }

        // GET /api/config —gateway effective config
        if (req.url?.match(/^\/api\/config(?:\?|$)/) && req.method === 'GET') {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(config.raw));
          return;
        }

        // PUT /api/config —persist config overrides to the data-root
        // config.yaml (the same file config.reload() reads), then hot-reload.
        if (req.url?.match(/^\/api\/config(?:\?|$)/) && req.method === 'PUT') {
          try {
            const overrides = JSON.parse(await readBody(req));
            const mafwDir = config.resolvePath();
            const configPath = path.join(mafwDir, 'config.yaml');
            if (!fs.existsSync(mafwDir)) fs.mkdirSync(mafwDir, { recursive: true });
            const yamlStr = yaml.dump(overrides, { indent: 2, lineWidth: 120, noRefs: true, sortKeys: true });
            fs.writeFileSync(configPath, yamlStr, 'utf-8');
            const reload = config.reload();
            if (reload.restartRequired.length > 0) {
              log.warn(`[Config] PUT saved, restart required for: ${reload.restartRequired.join(', ')}`);
            }
            res.writeHead(200);
            res.end(JSON.stringify({ success: true, restartRequired: reload.restartRequired }));
          } catch (err: any) {
            log.error('[Config] PUT error:', err.message);
            res.writeHead(400);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // 鎻掍欢娉ㄥ唽锛氬繀椤讳紶锟?projectDir + mafwDir
        if (req.url === '/register' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', async () => {
            try {
              const data = JSON.parse(body);
              const { projectDir, mafwDir } = data;

              if (!projectDir || !mafwDir) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Missing projectDir or mafwDir' }));
                return;
              }

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

              this.registeredProjects.set(projectDir, {
                projectDir,
                mafwDir,
                registeredAt: new Date().toISOString()
              });

              // 鎸佷箙鍖栧埌纾佺洏锛堝啓闃熷垪闃插苟鍙戣鐩栵級
              await this.persistRegistry();
              await this.persistConfig();

              if (this.opencodeClient) {
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

        // 鎺у埗鎸囦护
        if (req.url === '/control' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', async () => {
            try {
              const control = JSON.parse(body);
              log.info(`[Scheduler] HTTP control: ${control.action} ${control.goalId || ''}`);

              // 鐩存帴澶勭悊鎺у埗鎸囦护锛堝悓 processControlFile 閫昏緫锟?
              switch (control.action) {
                case 'PAUSE':
                  if (control.goalId) await this.patchState(control.goalId, { nextAction: 'PAUSED' });
                  break;
                case 'ABORT':
                  if (control.goalId) {
                    await this.destroyAllSessions(control.goalId);
                    await this.patchState(control.goalId, { nextAction: 'FAILED' });
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

        // POST /api/work/{goalId}/validate 锟?MCP calls when agent completes goal creation
        const validateMatch = req.url?.match(/^\/api\/work\/([^/]+)\/validate$/);
        if (validateMatch && req.method === 'POST') {
          try {
            const goalId = validateMatch[1];
            const body = await readBody(req);
            const data = body ? JSON.parse(body) : {};
            const result = await this.handleValidate(goalId, data);
            res.writeHead(200);
            res.end(JSON.stringify(result));
          } catch (err: any) {
            const status = err.message === 'Goal already exists' ? 409 : 400;
            res.writeHead(status);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // POST /api/work/{goalId}/complete 锟?MCP calls when agent completes a phase
        const completeMatch = req.url?.match(/^\/api\/work\/([^/]+)\/complete$/);
        if (completeMatch && req.method === 'POST') {
          try {
            const goalId = completeMatch[1];
            const body = await readBody(req);
            const data = body ? JSON.parse(body) : {};
            const result = await this.handleComplete(goalId, data);
            res.writeHead(200);
            res.end(JSON.stringify(result));
          } catch (err: any) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // POST /api/manager/session/rotate — start a new manager topic
        // (thin wiring → routes/manager-rotate.ts).
        if (req.method === 'POST' && req.url?.match(/^\/api\/manager\/session\/rotate(?:\?|$)/)) {
          await handleManagerRotate(req, res, this.rotateDeps());
          return;
        }

        // GET /api/manager/session — return manager session info (per-project,
        // read from the gateway DB). ?projectDir= filters a single project.
        if (req.url && req.url.startsWith('/api/manager/session') && req.method === 'GET') {
          const parsedUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
          const filter = parsedUrl.searchParams.get('projectDir') || '';
          try {
            const all = this.getGatewayDb().kvAll<{ sessionId: string; createdAt?: string | null }>('manager-session');
            if (filter) {
              const found = all.find((e) => e.key === filter);
              if (!found) {
                res.writeHead(404);
                res.end(JSON.stringify({ error: 'No manager session for project' }));
                return;
              }
              res.writeHead(200);
              res.end(
                JSON.stringify({
                  projectDir: found.key,
                  sessionId: found.value.sessionId,
                  createdAt: found.value.createdAt || null,
                }),
              );
              return;
            }
            if (all.length === 0) {
              res.writeHead(404);
              res.end(JSON.stringify({ error: 'No manager session' }));
              return;
            }
            res.writeHead(200);
            res.end(
              JSON.stringify(
                all.map((e) => ({
                  projectDir: e.key,
                  sessionId: e.value.sessionId,
                  createdAt: e.value.createdAt || null,
                })),
              ),
            );
          } catch (err: any) {
            log.warn(`[Scheduler] /api/manager/session failed: ${err.message}`);
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'Failed to read manager sessions' }));
          }
          return;
        }

        // 鍋ュ悍妫€锟?
        if (req.url === '/health' && req.method === 'GET') {
          res.writeHead(200);
          res.end(JSON.stringify({
            status: 'ok',
            serveRunning: !!this.serveInstance,
            registeredProjects: Array.from(this.registeredProjects.keys()),
            activeGoals: Array.from(this.activeGoals.keys()),
            media: { configured: !!this.mediaService?.isConfigured }
          }));
          return;
        }

        // GET /api/projects 锟?list registered projects
        if (req.url === '/api/projects' && req.method === 'GET') {
          const projects = Array.from(this.registeredProjects.values()).map(p => ({
            id: p.projectDir,
            worktree: p.projectDir,
          }));
          res.end(JSON.stringify({ projects }));
          return;
        }

        // GET /api/projects/current 锟?current/active project
        if (req.url === '/api/projects/current' && req.method === 'GET') {
          const entries = Array.from(this.registeredProjects.entries());
          if (entries.length === 0) {
            res.end(JSON.stringify({ project: null }));
            return;
          }
          const [projectDir, info] = entries[0];
          res.end(JSON.stringify({
            project: { id: projectDir, worktree: projectDir, mafwDir: info.mafwDir },
          }));
          return;
        }

        // POST /api/devices — register a mobile device for push notifications
        if (req.url?.match(/^\/api\/devices(?:\?|$)/) && req.method === 'POST') {
          try {
            const body = JSON.parse(await readBody(req));
            const { id, fcmToken, platform, token } = body;
            if (!id || !fcmToken || !platform || !token) {
              res.writeHead(400);
              res.end(JSON.stringify({ error: 'id, fcmToken, platform, token required' }));
              return;
            }
            // SECURITY: Compute apiTokenHash server-side from the token
            const { createHash } = require('crypto');
            const apiTokenHash = createHash('sha256').update(token).digest('hex').slice(0, 16);
            const entry = this.pushGateway?.registerDevice({ id, fcmToken, platform, apiTokenHash });
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true, device: entry }));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // GET /api/mobile/devices — list registered devices
        if (req.url?.match(/^\/api\/mobile\/devices(?:\?|$)/) && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ devices: this.pushGateway ? this.pushGateway.listDevices() : [] }));
          return;
        }

        // DELETE /api/mobile/devices/:id — remove a device
        const mobileDeviceDeleteMatch = req.url?.match(/^\/api\/mobile\/devices\/([^/]+)(?:\?|$)/);
        if (mobileDeviceDeleteMatch && req.method === 'DELETE') {
          const id = decodeURIComponent(mobileDeviceDeleteMatch[1]);
          const ok = this.pushGateway ? this.pushGateway.removeDevice(id) : false;
          res.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(ok ? { ok: true } : { error: 'device not found' }));
          return;
        }

        // GET /api/devices — legacy alias for list
        if (req.url?.match(/^\/api\/devices(?:\?|$)/) && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ devices: this.pushGateway ? this.pushGateway.listDevices() : [] }));
          return;
        }

        // DELETE /api/devices/:id — legacy alias for remove
        const legacyDeviceDeleteMatch = req.url?.match(/^\/api\/devices\/([^/]+)(?:\?|$)/);
        if (legacyDeviceDeleteMatch && req.method === 'DELETE') {
          const id = decodeURIComponent(legacyDeviceDeleteMatch[1]);
          const ok = this.pushGateway ? this.pushGateway.removeDevice(id) : false;
          res.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(ok ? { ok: true } : { error: 'device not found' }));
          return;
        }

        // POST /api/mobile/devices/register — mobile device registration alias
        // Maps mobile's { token, platform, deviceName } to gateway's { id, fcmToken, platform, apiTokenHash }
        if (req.url?.match(/^\/api\/mobile\/devices\/register(?:\?|$)/) && req.method === 'POST') {
          try {
            const body = JSON.parse(await readBody(req));
            const { token, platform, deviceName } = body;
            if (!token || !platform) {
              res.writeHead(400);
              res.end(JSON.stringify({ error: 'token and platform required' }));
              return;
            }
            const { createHash } = require('crypto');
            const id = createHash('sha256').update(token).digest('hex').slice(0, 32);
            const apiTokenHash = createHash('sha256').update(token).digest('hex').slice(0, 16);
            const entry = this.pushGateway?.registerDevice({ id, fcmToken: token, platform, apiTokenHash });
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true, device: entry }));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // GET /api/mobile/pairing-code — generate a single-use pairing URL for mobile scan
        if (req.url?.match(/^\/api\/mobile\/pairing-code(?:\?|$)/) && req.method === 'GET') {
          try {
            if (!this.pairingService) {
              res.writeHead(503);
              res.end(JSON.stringify({ error: 'Pairing service not available' }));
              return;
            }
            const ip = req.socket.remoteAddress || '';
            const result = this.pairingService.generatePairingCode(ip);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          } catch (err: any) {
            const msg = err?.message || String(err);
            const status = /rate limit/i.test(msg) ? 429 : 500;
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: msg }));
          }
          return;
        }

        // POST /api/mobile/pairing/verify — consume a pairing nonce after mobile scan
        if (req.url?.match(/^\/api\/mobile\/pairing\/verify(?:\?|$)/) && req.method === 'POST') {
          try {
            if (!this.pairingService) {
              res.writeHead(503);
              res.end(JSON.stringify({ error: 'Pairing service not available' }));
              return;
            }
            const body = JSON.parse(await readBody(req));
            const { nonce } = body;
            if (!nonce) {
              res.writeHead(400);
              res.end(JSON.stringify({ error: 'nonce required' }));
              return;
            }
            const consumed = this.pairingService.consumeNonce(nonce);
            if (!consumed) {
              res.writeHead(400);
              res.end(JSON.stringify({ error: 'Invalid or expired pairing nonce' }));
              return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // GET /api/approvals — list pending approvals
        if (req.url === '/api/approvals' && req.method === 'GET') {
          const approvals: any[] = [];
          // Read from .mafw/user-questions/ directories (flat layout)
          for (const [, info] of this.registeredProjects) {
            try {
              const qDir = path.join(info.mafwDir, 'user-questions');
              if (fs.existsSync(qDir)) {
                for (const f of fs.readdirSync(qDir).filter((f: string) => f.endsWith('.json'))) {
                  const q = JSON.parse(fs.readFileSync(path.join(qDir, f), 'utf-8'));
                  approvals.push({ id: f.replace('.json', ''), goalId: q.goalId, question: q.question, status: q.answered ? 'answered' : 'pending', createdAt: q.createdAt });
                }
                // legacy: questions previously stored under user-questions/{goalId}/
                for (const gDir of fs.readdirSync(qDir)) {
                  const gPath = path.join(qDir, gDir);
                  if (!fs.statSync(gPath).isDirectory()) continue;
                  for (const file of fs.readdirSync(gPath).filter((f: string) => f.endsWith('.json'))) {
                    const q = JSON.parse(fs.readFileSync(path.join(gPath, file), 'utf-8'));
                    approvals.push({ id: file.replace('.json', ''), goalId: gDir, question: q.question, status: q.answered ? 'answered' : 'pending', createdAt: q.createdAt });
                  }
                }
              }
            } catch { /* ignore */ }
          }
          res.end(JSON.stringify({ approvals }));
          return;
        }

        // POST /api/approvals/{id}/respond 锟?respond to an approval
        const approveMatch = req.url?.match(/^\/api\/approvals\/([^/]+)\/respond$/);
        if (approveMatch && req.method === 'POST') {
          res.end(JSON.stringify({ status: 'ok' }));
          return;
        }

        // 鈹€鈹€ Question endpoints (AskCard 鈹€ proxy to native opencode Question API) 鈹€鈹€

        // GET /api/questions 鈹€ list pending questions
        if (req.url?.match(/^\/api\/questions(?:\?|$)/) && req.method === 'GET') {
          if (this.capGuard(res, 'nativeApprovals')) return;
          try {
            const dir = new URL(req.url, this.serveUrl).searchParams.get('directory') || this.projectDir || '.';
            const r = await fetch(`${this.serveUrl}/question?directory=${encodeURIComponent(dir)}`, {
              headers: { 'x-opencode-directory': encodeURIComponent(dir) },
            });
            const items = await r.json();
            res.end(JSON.stringify({ items }));
          } catch (err: any) {
            log.error('[Question] list error:', err.message);
            res.end(JSON.stringify({ items: [] }));
          }
          return;
        }

        // POST /api/questions/{id}/reply 鈹€ { answers: string[][] }
        const qReplyMatch = req.url?.match(/^\/api\/questions\/([^/]+)\/reply(?:\?|$)/);
        if (qReplyMatch && req.method === 'POST') {
          if (this.capGuard(res, 'nativeApprovals')) return;
          try {
            const body = JSON.parse(await readBody(req));
            const r = await this.proxyNativeWorkspaces(`/question/${qReplyMatch[1]}/reply`, 'POST', { answers: body.answers });
            if (!r.ok) {
              res.writeHead(r.status);
              res.end(JSON.stringify({ status: 'error', code: r.status }));
              return;
            }
            res.end(JSON.stringify({ status: 'ok' }));
          } catch (err: any) {
            log.error('[Question] reply error:', err.message);
            res.writeHead(400);
            res.end(JSON.stringify({ status: 'error', error: err.message }));
          }
          return;
        }

        // POST /api/questions/{id}/reject
        const qRejectMatch = req.url?.match(/^\/api\/questions\/([^/]+)\/reject(?:\?|$)/);
        if (qRejectMatch && req.method === 'POST') {
          if (this.capGuard(res, 'nativeApprovals')) return;
          try {
            const r = await this.proxyNativeWorkspaces(`/question/${qRejectMatch[1]}/reject`, 'POST');
            if (!r.ok) {
              res.writeHead(r.status);
              res.end(JSON.stringify({ status: 'error', code: r.status }));
              return;
            }
            res.end(JSON.stringify({ status: 'ok' }));
          } catch (err: any) {
            log.error('[Question] reject error:', err.message);
            res.writeHead(400);
            res.end(JSON.stringify({ status: 'error', error: err.message }));
          }
          return;
        }

        // 鈹€鈹€ Permission endpoints (PermissionCard 鈹€ proxy to native opencode Permission API) 鈹€鈹€

        // GET /api/permissions 鈹€ list pending permission requests
        if (req.url?.match(/^\/api\/permissions(?:\?|$)/) && req.method === 'GET') {
          if (this.capGuard(res, 'nativeApprovals')) return;
          try {
            const dir = new URL(req.url, this.serveUrl).searchParams.get('directory') || this.projectDir || '.';
            const r = await fetch(`${this.serveUrl}/permission?directory=${encodeURIComponent(dir)}`, {
              headers: { 'x-opencode-directory': encodeURIComponent(dir) },
            });
            const items = await r.json();
            res.end(JSON.stringify({ items }));
          } catch (err: any) {
            log.error('[Permission] list error:', err.message);
            res.end(JSON.stringify({ items: [] }));
          }
          return;
        }

        // 鈹€鈹€ Provider & Agents (composer model pill / @agent mention) 鈹€鈹€

        // ── /api/runtime routes (thin wiring → routes/runtime-switch.ts) ──
        if (req.url?.match(/^\/api\/runtime(?:\/|$)/)) {
          const runtimeDeps = {
            loader: this.runtimeLoader,
            persist: (o: Record<string, any>) => config.persistOverrides(o),
            getCurrent: () => this.opencodeClient,
            runtimeName: () => this.runtimeName,
            runtimeCaps: () => this.runtimeCaps,
            envOverride: () => !!process.env.MAFW_RUNTIME_PLUGIN,
            createRuntime: async () => {
              const sdkConfig = {
                baseUrl: this.serveUrl,
                directory: this.projectDir,
                headers: {} as Record<string, string>,
              };
              const opencodePassword = process.env.MAFW_OPENCODE_PASSWORD;
              if (opencodePassword) {
                sdkConfig.headers = { Authorization: 'Basic ' + Buffer.from(`opencode:${opencodePassword}`).toString('base64') };
              }
              return this.createRuntime(sdkConfig);
            },
            onSwitched: async (rt: AgentRuntime, prev: AgentRuntime | null) => {
              this.opencodeClient = rt;
              this.runtimeCaps = rt.capabilities;
              this.runtimeName = rt.name;
              this.sdkSession.setClient(this.opencodeClient);
              if (this.trajectoryCollector) this.trajectoryCollector.setOpencodeClient(this.opencodeClient);
              if (this.automationEngine) this.automationEngine.setRuntimeClient(rt);
              await this.resubscribeEvents(`runtime switched to '${rt.name}'`);
              if (prev && (prev as any).dispose) {
                try { await (prev as any).dispose(); }
                catch (err: any) { log.warn(`[Runtime] dispose old runtime failed: ${err.message}`); }
              }
            },
          };

          if (req.method === 'GET' && req.url?.match(/^\/api\/runtime(?:\?|$)/)) {
            await handleRuntimeGet(req, res, runtimeDeps);
            return;
          }
          if (req.method === 'POST' && req.url?.match(/^\/api\/runtime\/switch(?:\?|$)/)) {
            if (this.serveRecovering || this.switchingRuntime) {
              res.writeHead(409, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Cannot switch runtime during agent restart' }));
              return;
            }
            this.switchingRuntime = true;
            try {
              await handleRuntimeSwitch(req, res, runtimeDeps);
            } finally {
              this.switchingRuntime = false;
            }
            return;
          }
          if (req.method === 'POST' && req.url?.match(/^\/api\/runtime\/reload(?:\?|$)/)) {
            await handleRuntimeReload(req, res, runtimeDeps);
            return;
          }
          if (req.method === 'POST' && req.url?.match(/^\/api\/runtime\/restart-agent(?:\?|$)/)) {
            await handleRestartAgent(req, res, {
              capabilities: () => this.runtimeCaps,
              isRecovering: () => this.serveRecovering,
              isSwitching: () => this.switchingRuntime,
              begin: () => { this.serveRecovering = true; },
              end: () => { this.serveRecovering = false; },
              restartAgent: () => this.restartAgentOrchestrated(),
            });
            return;
          }
          return;
        }

        // GET /api/orchestration/outcomes — goal outcome query
        if (req.url?.match(/^\/api\/orchestration\/outcomes(?:\?|$)/) && req.method === 'GET') {
          const u = new URL(req.url, 'http://localhost');
          const rows = this.getGatewayDb().listGoalOutcomes({
            policy: u.searchParams.get('policy') || undefined,
            verdict: u.searchParams.get('verdict') || undefined,
            project: u.searchParams.get('project') || undefined,
            limit: parseInt(u.searchParams.get('limit') || '100', 10),
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ outcomes: rows }));
          return;
        }

        // GET /api/provider – list providers + models (legacy /provider)
        if (req.url?.match(/^\/api\/provider(?:\?|$)/) && req.method === 'GET') {
          if (this.capGuard(res, 'providerConfigApi')) return;
          try {
            if (!this.opencodeClient) { res.writeHead(503); res.end(JSON.stringify({ error: 'LLM client not available' })); return; }
            const result = await this.opencodeClient.provider.list();
            res.end(JSON.stringify({ items: result ?? null }));
          } catch (err: any) {
            log.error('[Provider] list error:', err.message);
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // GET /api/agents 鈹€ list available agents (legacy /agent)
        if (req.url?.match(/^\/api\/agents(?:\?|$)/) && req.method === 'GET') {
          if (this.capGuard(res, 'providerConfigApi')) return;
          try {
            if (!this.opencodeClient) { res.writeHead(503); res.end(JSON.stringify({ error: 'LLM client not available' })); return; }
            const agents = await this.opencodeClient.app.agents();
            res.end(JSON.stringify({ items: Array.isArray(agents) ? agents : [] }));
          } catch (err: any) {
            log.error('[Agents] list error:', err.message);
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // 鈹€鈹€ OpenCode config (Settings page 鈹€ proxy to native opencode /config) 鈹€鈹€

        // GET /api/opencode-config 鈹€ return the effective opencode Config
        if (req.url?.match(/^\/api\/opencode-config(?:\?|$)/) && req.method === 'GET') {
          if (this.capGuard(res, 'providerConfigApi')) return;
          try {
            if (!this.opencodeClient) { res.writeHead(503); res.end(JSON.stringify({ error: 'LLM client not available' })); return; }
            const configData = await this.opencodeClient.config.get();
            res.end(JSON.stringify({ config: configData ?? {} }));
          } catch (err: any) {
            log.error('[OpenCodeConfig] get error:', err.message);
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // PATCH /api/opencode-config 鈹€ merge-update the opencode Config (native merge semantics)
        if (req.url?.match(/^\/api\/opencode-config(?:\?|$)/) && req.method === 'PATCH') {
          if (this.capGuard(res, 'providerConfigApi')) return;
          try {
            if (!this.opencodeClient) { res.writeHead(503); res.end(JSON.stringify({ error: 'LLM client not available' })); return; }
            const body = JSON.parse(await readBody(req));
            const result = await this.opencodeClient.config.update(body);
            res.end(JSON.stringify({ status: 'ok', config: result ?? null }));
          } catch (err: any) {
            log.error('[OpenCodeConfig] update error:', err.message);
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // POST /api/permissions/{id}/reply 鈹€ { reply: 'once'|'always'|'reject', message?: string }
        const pReplyMatch = req.url?.match(/^\/api\/permissions\/([^/]+)\/reply(?:\?|$)/);
        if (pReplyMatch && req.method === 'POST') {
          if (this.capGuard(res, 'nativeApprovals')) return;
          try {
            const body = JSON.parse(await readBody(req));
            const payload: any = { reply: body.reply };
            if (body.message) payload.message = body.message;
            const r = await this.proxyNativeWorkspaces(`/permission/${pReplyMatch[1]}/reply`, 'POST', payload);
            if (!r.ok) {
              res.writeHead(r.status);
              res.end(JSON.stringify({ status: 'error', code: r.status }));
              return;
            }
            res.end(JSON.stringify({ status: 'ok' }));
          } catch (err: any) {
            log.error('[Permission] reply error:', err.message);
            res.writeHead(400);
            res.end(JSON.stringify({ status: 'error', error: err.message }));
          }
          return;
        }

        // 鈹€鈹€ Triage endpoints (Tier 4 锟?user only, not MCP) 鈹€鈹€

        // GET /api/triage 锟?list triage items (with llmSuggestions)
        if (req.url === '/api/triage' && req.method === 'GET') {
          const items = this.automationEngine?.getTriageItems() || [];
          res.end(JSON.stringify({ items }));
          return;
        }

        // POST /api/triage/{id}/confirm 锟?user confirms triage 锟?creates goal
        const triageConfirmMatch = req.url?.match(/^\/api\/triage\/([^/]+)\/confirm$/);
        if (triageConfirmMatch && req.method === 'POST') {
          const triageId = triageConfirmMatch[1];
          const item = this.automationEngine?.getTriageItem(triageId);
          if (!item) {
            res.writeHead(404); res.end(JSON.stringify({ error: 'Triage item not found' })); return;
          }
          if (item.state !== 'PENDING_CONFIRMATION') {
            res.writeHead(400); res.end(JSON.stringify({ error: `Already ${item.state}` })); return;
          }
          const goalId = `confirmed-${item.automationId}-${Date.now()}`;
          this.automationEngine?.confirmTriage(goalId, item);
          const requestsDir = path.join(this.mafwDir, 'requests');
          if (!fs.existsSync(requestsDir)) fs.mkdirSync(requestsDir, { recursive: true });
          fs.writeFileSync(path.join(requestsDir, `${goalId}.json`), JSON.stringify({
            goalId,
            source: 'triage-confirm',
            automationId: item.automationId,
            title: item.proposedGoal.title,
            boundaries: item.proposedGoal.boundaries,
            maxLoops: item.proposedGoal.estimatedLoops,
            createdAt: new Date().toISOString(),
          }, null, 2), 'utf-8');
          this.ledger?.append({
            timestamp: new Date().toISOString(),
            event: 'AUTOMATION_TRIGGERED',
            ruleId: item.automationId,
            goalId,
            source: 'user',
            reason: 'triage_confirmed',
          });
          res.end(JSON.stringify({ status: 'confirmed', goalId }));
          return;
        }

        // POST /api/triage/{id}/reject 锟?user rejects triage
        const triageRejectMatch = req.url?.match(/^\/api\/triage\/([^/]+)\/reject$/);
        if (triageRejectMatch && req.method === 'POST') {
          const triageId = triageRejectMatch[1];
          const ok = this.automationEngine?.rejectTriage(triageId);
          this.ledger?.append({
            timestamp: new Date().toISOString(),
            event: 'AUTOMATION_TRIGGERED',
            source: 'user',
            reason: 'triage_rejected',
            details: { triageId },
          });
          res.end(JSON.stringify({ status: ok ? 'rejected' : 'not_found' }));
          return;
        }

        // 鈹€鈹€ Automation endpoints (Tier 4 锟?user only) 鈹€鈹€

        // GET /api/automations 锟?list automation rules with next trigger + recent history
        if (req.url === '/api/automations' && req.method === 'GET') {
          const rules = this.automationEngine?.getRules() || [];
          const enriched = rules.map(r => ({
            ...r,
            nextTriggers: this.automationEngine?.getNextTriggers(r).next5 || [],
            recentHistory: this.ledger?.getHistory(r.id, 3) || [],
          }));
          res.end(JSON.stringify({ rules: enriched }));
          return;
        }

        // GET /api/automations/{id} 锟?single rule detail
        const autoGetMatch = req.url?.match(/^\/api\/automations\/([^/]+)(?:\?|$)/);
        if (autoGetMatch && req.method === 'GET') {
          const id = autoGetMatch[1];
          const rule = this.automationEngine?.getRule(id);
          if (!rule) { res.writeHead(404); res.end(JSON.stringify({ error: 'Rule not found' })); return; }
          res.end(JSON.stringify({
            ...rule,
            nextTriggers: this.automationEngine?.getNextTriggers(rule)?.next5 || [],
            history: this.ledger?.getHistory(id, 10) || [],
          }));
          return;
        }

        // PUT /api/automations/{id} 锟?toggle an automation rule (enabled/disabled)
        if (autoGetMatch && req.method === 'PUT') {
          try {
            const id = autoGetMatch[1];
            const body = await readBody(req);
            const { enabled } = JSON.parse(body);
            const ok = this.automationEngine?.toggleRule(id, enabled);
            this.ledger?.append({
              timestamp: new Date().toISOString(),
              event: 'AUTOMATION_TRIGGERED',
              ruleId: id,
              source: 'user',
              reason: enabled ? 'enabled' : 'disabled',
            });
            res.end(JSON.stringify({ status: ok ? 'toggled' : 'not_found', enabled }));
          } catch (err: any) {
            res.writeHead(400); res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // DELETE /api/automations/{id} 锟?delete an automation rule
        if (autoGetMatch && req.method === 'DELETE') {
          const id = autoGetMatch[1];
          const ok = this.automationEngine?.deleteRule(id);
          this.ledger?.append({
            timestamp: new Date().toISOString(),
            event: 'AUTOMATION_TRIGGERED',
            ruleId: id,
            source: 'user',
            reason: 'deleted',
          });
          res.end(JSON.stringify({ status: ok ? 'deleted' : 'not_found' }));
          return;
        }

        // GET /api/automations/{id}/history 锟?audit trail for a rule
        const autoHistoryMatch = req.url?.match(/^\/api\/automations\/([^/]+)\/history(?:\?|$)/);
        if (autoHistoryMatch && req.method === 'GET') {
          const id = autoHistoryMatch[1];
          const limit = parseInt(new URL(req.url!, `http://${req.headers.host}`).searchParams.get('limit') || '20');
          const history = this.ledger?.getHistory(id, limit) || [];
          res.end(JSON.stringify({ history }));
          return;
        }

        // POST /api/llm/compress 锟?LLM compression proxy (via SDK)
        if (req.url === '/api/llm/compress' && req.method === 'POST') {
          try {
            const body = await readBody(req);
            const { observations, model } = JSON.parse(body);
            if (!observations || !Array.isArray(observations)) throw new Error('observations array required');
            const result = await this.handleCompress(observations, model);
            res.writeHead(200);
            res.end(JSON.stringify(result));
          } catch (err: any) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // 鈹€鈹€ SdkSessionResource REST endpoints 鈹€鈹€

        // POST /api/session 锟?create a session
        if (req.url === '/api/session' && req.method === 'POST') {
          try {
            const body = await readBody(req);
            const opts = body ? JSON.parse(body) : {};
            const result = await this.sdkSession.create(opts.directory, opts.metadata);
            res.writeHead(200);
            res.end(JSON.stringify(result));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // POST /api/session/{id}/promptAsync 锟?fire-and-forget prompt
        const promptAsyncMatch = req.url?.match(/^\/api\/session\/([^/]+)\/promptAsync(?:\?|$)/);
        if (promptAsyncMatch && req.method === 'POST') {
          try {
            const sessionID = promptAsyncMatch[1];
            const body = await readBody(req);
            const { message, parts, agent, model } = body ? JSON.parse(body) : {};
            if (!message && !Array.isArray(parts)) { res.writeHead(400); res.end(JSON.stringify({ error: 'message or parts required' })); return; }
            await this.sdkSession.promptAsync(sessionID, message, parts, agent, model);
            res.writeHead(200);
            res.end(JSON.stringify({ status: 'ok' }));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // POST /api/session/{id}/prompt 锟?synchronous prompt
        const promptMatch = req.url?.match(/^\/api\/session\/([^/]+)\/prompt$/);
        if (promptMatch && req.method === 'POST') {
          try {
            const sessionID = promptMatch[1];
            const body = await readBody(req);
            const opts = body ? JSON.parse(body) : {};
            const result = await this.sdkSession.prompt(sessionID, opts.parts || [], opts.system);
            res.writeHead(200);
            res.end(JSON.stringify(result));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // DELETE /api/session/{id} 锟?delete a session
        const deleteMatch = req.url?.match(/^\/api\/session\/([^/]+)$/);
        if (deleteMatch && req.method === 'DELETE') {
          try {
            const sessionID = deleteMatch[1];
            await this.sdkSession.delete(sessionID);
            try { this.trajectoryStore?.deleteSession(sessionID); } catch (err: any) { log.warn(`[Trajectory] delete failed: ${err.message}`); }
            res.writeHead(200);
            res.end(JSON.stringify({ status: 'ok' }));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // POST /api/session/{id}/abort —abort an in-flight run
        const abortMatch = req.url?.match(/^\/api\/session\/([^/]+)\/abort$/);
        if (abortMatch && req.method === 'POST') {
          try {
            const sessionID = abortMatch[1];
            if (!this.opencodeClient) {
              res.writeHead(503);
              res.end(JSON.stringify({ error: 'LLM client not available' }));
              return;
            }
            await this.opencodeClient.session.abort({ sessionID });
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true }));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // DELETE/PATCH /api/sessions/:id — true forwards (rename / delete)
        if (await handleSessionMutations(req, res, {
          getCapabilities: () => this.runtimeCaps,
          getClient: () => (this.opencodeClient ?? null) as any,
        })) {
          return;
        }

        // GET /api/sessions 锟?list sessions (optional ?projectID=xxx)
        if (req.url?.match(/^\/api\/sessions(?:\?|$)/) && req.method === 'GET') {
          try {
            const parsedUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
            const projectID = parsedUrl.searchParams.get('projectID');
            const sessions = await this.listSessions(projectID);
            res.writeHead(200);
            res.end(JSON.stringify({ sessions }));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // POST /api/sessions/{id}/permissions/{requestId} — forward permission reply to runtime
        const permMatch = req.url?.match(/^\/api\/sessions\/([^/]+)\/permissions\/([^/]+)(?:\?|$)/);
        if (permMatch && req.method === 'POST') {
          await handlePermissionReply(this.opencodeClient, req, res, permMatch[1], permMatch[2]);
          return;
        }

        // GET /api/sessions/{id} —get session via SDK (with local fallback)
        const sessionsGetMatch = req.url?.match(/^\/api\/sessions\/([^/]+)(?:\?|$)/);
        if (sessionsGetMatch && req.method === 'GET') {
          try {
            const id = sessionsGetMatch[1];
            if (this.opencodeClient) {
              try {
                const session = await this.opencodeClient.session.get({ sessionID: id });
                if (session) { res.writeHead(200); res.end(JSON.stringify(session)); return; }
              } catch {}
            }
            const session = await this.sdkSession.get(id);
            res.writeHead(200);
            res.end(JSON.stringify(session || { error: 'not found' }));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // GET /api/sessions/{id}/messages 锟?fetch session message history via SDK
        const messagesMatch = req.url?.match(/^\/api\/sessions\/([^/]+)\/messages(?:\?|$)/);
        if (messagesMatch && req.method === 'GET') {
          try {
            const id = messagesMatch[1];
            if (!this.opencodeClient) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ data: [] }));
              return;
            }
            const parsedUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
            const limit = parseInt(parsedUrl.searchParams.get('limit') || '100', 10);
            const before = parsedUrl.searchParams.get('before') || undefined;
            const result = await this.opencodeClient.session.messages({
              sessionID: id,
              limit,
              ...(before ? { before } : {}),
            });
            const rawData = result.data || [];
            const nextCursor = result.nextCursor || null;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ data: Array.isArray(rawData) ? rawData : [], nextCursor }));
          } catch (err: any) {
            log.warn(`[Scheduler] Failed to fetch messages (serve may not be ready): ${err.message}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ data: [] }));
          }
          return;
        }

        // GET /api/sessions/{id}/todo —fetch session todo list (task panel)
        const todoMatch = req.url?.match(/^\/api\/sessions\/([^/]+)\/todo(?:\?|$)/);
        if (todoMatch && req.method === 'GET') {
          const id = todoMatch[1];
          try {
            if (!this.opencodeClient) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ data: [] }));
              return;
            }
            const result = await this.opencodeClient.session.todo({ sessionID: id });
            const rawData = Array.isArray(result) ? result : [];
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ data: Array.isArray(rawData) ? rawData : [] }));
          } catch (err: any) {
            log.warn(`[Scheduler] Failed to fetch todos for ${id}: ${err.message}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ data: [] }));
          }
          return;
        }

        // GET /api/sessions/{id}/trajectory —agent trajectory timeline (task/desktop)
        const trajectoryMatch = req.url?.match(/^\/api\/sessions\/([^/]+)\/trajectory(?:\?|$)/);
        if (trajectoryMatch && req.method === 'GET') {
          const id = trajectoryMatch[1];
          try {
            const parsedUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
            const limit = Math.min(parseInt(parsedUrl.searchParams.get('limit') || '50', 10), 200);
            const beforeTurn = parsedUrl.searchParams.get('before_turn') ? Number(parsedUrl.searchParams.get('before_turn')) : undefined;
            const rebuild = parsedUrl.searchParams.get('rebuild') === '1';
            const store = this.trajectoryStore;
            if (!store) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ turns: [], events: [] }));
              return;
            }
            if (rebuild) {
              try {
                const result = await this.opencodeClient?.session.messages({ sessionID: id, limit: 200 });
                const data = result?.data || [];
                const messages = Array.isArray(data) ? data : [];
                const { handleTrajectoryRequest } = require('./trajectory/api') as typeof import('./trajectory/api');
                const out = await handleTrajectoryRequest({ store, sessionID: id, opts: { limit, beforeTurn, rebuild }, messages: { data: messages }, projectID: this.projectDir || '.' });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(out));
                return;
              } catch (err: any) {
                log.warn(`[Trajectory] rebuild failed (non-fatal): ${err.message}`);
              }
            }
            const { handleTrajectoryRequest } = require('./trajectory/api') as typeof import('./trajectory/api');
            const out = await handleTrajectoryRequest({ store, sessionID: id, opts: { limit, beforeTurn } });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(out));
          } catch (err: any) {
            log.warn(`[Trajectory] fetch failed (non-fatal): ${err.message}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ turns: [], events: [] }));
          }
          return;
        }

        // GET /api/sessions/{id}/token-summary — per-session token/cost totals
        const tokenSummaryMatch = req.url?.match(/^\/api\/sessions\/([^/]+)\/token-summary(?:\?|$)/);
        if (tokenSummaryMatch && req.method === 'GET') {
          const id = tokenSummaryMatch[1];
          try {
            const store = this.trajectoryStore;
            if (!store) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ totalTokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, totalCost: 0, turnCount: 0, avgTokensPerTurn: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }));
              return;
            }
            const summary = store.getSessionTokenSummary(id);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(summary));
          } catch (err: any) {
            log.warn(`[TokenSummary] fetch failed: ${err.message}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ totalTokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, totalCost: 0, turnCount: 0, avgTokensPerTurn: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }));
          }
          return;
        }

        // GET /api/usage/plugins — plugin state list
        if (req.url?.match(/^\/api\/usage\/plugins(?:\?|$)/) && req.method === 'GET') {
          const plugins = (this.pluginLoader?.getState() ?? []).map(s => ({
            file: s.file,
            name: s.name,
            status: s.status,
            error: s.error,
            overridden: s.overridden,
          }));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ plugins }));
          return;
        }

        // POST /api/usage/plugins/reload — manual reload
        if (req.url?.match(/^\/api\/usage\/plugins\/reload$/) && req.method === 'POST') {
          await this.pluginLoader?.reload();
          const plugins = (this.pluginLoader?.getState() ?? []).map(s => ({
            file: s.file,
            name: s.name,
            status: s.status,
            error: s.error,
            overridden: s.overridden,
          }));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, plugins }));
          return;
        }

        // GET /api/media/plugins — media engine plugin state list
        if (req.url?.match(/^\/api\/media\/plugins(?:\?|$)/) && req.method === 'GET') {
          const plugins = (this.mediaPluginLoader?.getState() ?? []).map(s => ({
            file: s.file,
            name: s.name,
            status: s.status,
            error: s.error,
            modalities: s.modalities,
          }));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ plugins }));
          return;
        }

        // POST /api/media/plugins/reload — manual reload
        if (req.url?.match(/^\/api\/media\/plugins\/reload$/) && req.method === 'POST') {
          await this.mediaPluginLoader?.reload();
          const plugins = (this.mediaPluginLoader?.getState() ?? []).map(s => ({
            file: s.file,
            name: s.name,
            status: s.status,
            error: s.error,
            modalities: s.modalities,
          }));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, plugins }));
          return;
        }

        // POST /api/media/switch — switch media engine per modality
        if (req.url?.match(/^\/api\/media\/switch(?:\?|$)/) && req.method === 'POST') {
          await handleMediaSwitch(req, res, {
            persist: (o) => config.persistOverrides(o),
            reloadPlugins: async () => { await this.mediaPluginLoader?.reload(); },
            availableEngines: () => (this.mediaPluginLoader?.getState().map(s => s.name).filter((n): n is string => !!n) ?? []),
            currentMedia: () => ({
              engine: config.raw.media.engine,
              image: config.raw.media.image,
              video: config.raw.media.video,
              audio: config.raw.media.audio,
            }),
          });
          return;
        }

        // GET/POST /api/model-config — recall worker model + media models (hot-apply)
        if (req.url?.match(/^\/api\/model-config(?:\?|$)/) && req.method === 'GET') {
          await handleModelConfigGet(req, res, this.modelConfigDeps());
          return;
        }
        if (req.url?.match(/^\/api\/model-config(?:\?|$)/) && req.method === 'POST') {
          await handleModelConfigUpdate(req, res, this.modelConfigDeps());
          return;
        }

        // GET /api/usage?sessionID=xxx&projectID=xxx — consolidated usage (summary + providers)
        if (req.url?.match(/^\/api\/usage(?:\?|$)/) && req.method === 'GET') {
          try {
            const parsedUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
            const sessionID = parsedUrl.searchParams.get('sessionID') || '';
            const projectID = parsedUrl.searchParams.get('projectID') || '';
            const store = this.trajectoryStore;
            const empty = { totalTokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, totalCost: 0, turnCount: 0, sessionCount: 0 };
            const summary: any = { session: { ...empty, avgTokensPerTurn: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }, project: { ...empty }, global: { ...empty } };
            if (store) {
              if (sessionID) summary.session = store.getSessionTokenSummary(sessionID);
              if (projectID) summary.project = store.getProjectTokenSummary(projectID);
              summary.global = store.getGlobalTokenSummary();
            }
            const memory = store ? store.getMemoryTokenSummary() : null;
            const providerData = this.usagePoller ? await this.usagePoller.poll() : { providers: [], updatedAt: Date.now() };
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ summary, memory, ...providerData }));
          } catch (err: any) {
            log.warn(`[Usage] failed: ${err.message}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ summary: null, providers: [], updatedAt: Date.now() }));
          }
          return;
        }

        // GET /api/usage/summary — backward compat alias
        if (req.url?.match(/^\/api\/usage\/summary(?:\?|$)/) && req.method === 'GET') {
          try {
            const parsedUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
            const sessionID = parsedUrl.searchParams.get('sessionID') || '';
            const projectID = parsedUrl.searchParams.get('projectID') || '';
            const store = this.trajectoryStore;
            const empty = { totalTokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, totalCost: 0, turnCount: 0, sessionCount: 0 };
            const result: any = { session: { ...empty, avgTokensPerTurn: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }, project: { ...empty }, global: { ...empty } };
            if (store) {
              if (sessionID) result.session = store.getSessionTokenSummary(sessionID);
              if (projectID) result.project = store.getProjectTokenSummary(projectID);
              result.global = store.getGlobalTokenSummary();
            }
            const memory = store ? store.getMemoryTokenSummary() : null;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ...result, memory }));
          } catch (err: any) {
            log.warn(`[UsageSummary] failed: ${err.message}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ session: null, project: null, global: null }));
          }
          return;
        }

        // GET /api/sessions/{id}/children —subagent sessions of this run (AgentPicker)
        const childrenMatch = req.url?.match(/^\/api\/sessions\/([^/]+)\/children(?:\?|$)/);
        if (childrenMatch && req.method === 'GET') {
          const id = childrenMatch[1];
          try {
            if (!this.opencodeClient) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ items: [] }));
              return;
            }
            const result = await this.opencodeClient.session.children({ sessionID: id });
            const items = Array.isArray(result) ? result : [];
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ items: Array.isArray(items) ? items : [] }));
          } catch (err: any) {
            log.warn(`[Scheduler] Failed to fetch children for ${id}: ${err.message}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ items: [] }));
          }
          return;
        }

        // GET /api/recall/context —boundary recall for memory injection
        if (req.url?.startsWith('/api/recall/context') && req.method === 'GET') {
          try {
            const parsedUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
            const query = parsedUrl.searchParams.get('query') || '';
            const sessionID = parsedUrl.searchParams.get('sessionID') || '';
            // Goal snapshot: injected every turn for the ACTIVE manager session
            // only (kv compare). Compaction-proof goal awareness (spec §3.4①).
            let goalSnap: string | null = null;
            if (sessionID) {
              const ms = this.getGatewayDb()
                .kvAll<{ sessionId: string }>('manager-session')
                .find(e => e.value.sessionId === sessionID);
              if (ms) {
                const info = this.registeredProjects.get(ms.key);
                const mafwDir = info?.mafwDir ?? path.join(ms.key, '.mafw');
                try { goalSnap = buildGoalSnapshot(mafwDir); } catch { /* fail-open */ }
              }
            }
            if (!query.trim()) {
              res.writeHead(200);
              res.end(JSON.stringify({ pointers: goalSnap }));
              return;
            }
            const { formatRecallContext } = require('./recall/inject-format');
            const { searchRecallMemories } = require('./recall/recall-context');
            let memories: any[] = [];
            if (this.memoryService) {
              // B3: memories already actively pushed by path 1 (step injection)
              // are filtered out so boundary recall never re-exposes them.
              const pushed = this.stepInject.pushedMemoriesFor(sessionID);
              // Sync path is BM25-only (<50ms): the plugin client aborts after
              // 100ms. Scan results arrive via async prefetch snapshot (C).
              const scanSnapshot = this.getScanService()?.getSnapshot(sessionID) ?? null;
              memories = await searchRecallMemories(
                this.memoryService.harmonicIndex,
                query,
                pushed,
                3,
                {
                  retriever: config.search.defaultRetriever,
                  scanSnapshot,
                },
              );
            }
            const formatted = formatRecallContext(memories);
            const pointers = goalSnap
              ? (formatted.pointers ? `${formatted.pointers}\n\n${goalSnap}` : goalSnap)
              : formatted.pointers;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ pointers }));
          } catch (err: any) {
            log.error('[Scheduler] recall/context error:', err.message);
            res.writeHead(200);
            res.end(JSON.stringify({ pointers: null }));
          }
          return;
        }

        // GET /api/recall/pinned — disclosure layer for system prompt injection.
        // Pinned memories appear every turn regardless of retrieval; fail-open.
        if (req.url?.startsWith('/api/recall/pinned') && req.method === 'GET') {
          try {
            if (!this.memoryService) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ profile: null, entries: [], budget: { max: 20, maxChars: 2000, used: 0 } }));
              return;
            }
            const { handleRecallPinned } = require('./routes/pinned-recall');
            const { HarmonicUnitFileStore } = require('./memory/harmonic-file-store.js');
            const store = new HarmonicUnitFileStore(config.resolvePath(), this.memoryService.harmonicIndex);
            const result = await handleRecallPinned({
              getIndex: () => this.memoryService!.harmonicIndex.getIndex(),
              readUnit: (id: string) => store.read(id),
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          } catch (err: any) {
            log.error('[Scheduler] recall/pinned error:', err.message);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ profile: null, entries: [], budget: { max: 20, maxChars: 2000, used: 0 } }));
          }
          return;
        }

        // POST /api/obs/capture — observation intake from the opencode plugin.
        // The gateway owns the T1 store (SQLite) and assigns turn IDs, so
        // plugin/serve restarts can never renumber turns or duplicate writes
        // (database-level UNIQUE dedup).
        if (req.url === '/api/obs/capture' && req.method === 'POST') {
          let body = '';
          let aborted = false;
          req.on('data', (chunk: Buffer) => {
            body += chunk.toString('utf-8');
            if (body.length > 1_000_000) {
              aborted = true;
              req.destroy();
            }
          });
          req.on('end', () => {
            if (aborted) return;
            try {
              const data = JSON.parse(body);
              const sessionID = String(data?.sessionID || '');
              const source = String(data?.source || '');
              const content = typeof data?.content === 'string' ? data.content : '';
              const failure = data?.failure ? 1 : 0;
              if (!sessionID || !['user_input', 'assistant_reply', 'tool_result', 'reasoning'].includes(source)) {
                res.writeHead(400);
                res.end(JSON.stringify({ ok: false, error: 'sessionID and valid source required' }));
                return;
              }
              if (!content.trim()) {
                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, id: null, deduped: true, turnId: 0 }));
                return;
              }
              // Recursion guard (A): internal pipeline sessions must never feed
              // their own output back into T1 as observations.
              if (this.internalSessionRoles.has(sessionID)) {
                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, id: null, deduped: true, turnId: 0, internal: true }));
                return;
              }
              // Recursion guard (B): content that looks like a pipeline
              // extraction prompt is pipeline-internal noise, never a real
              // user/agent observation.
              if (/Analyze the following agent observations|extract structured memories/i.test(content)) {
                res.writeHead(200);
                res.end(JSON.stringify({ ok: true, id: null, deduped: true, turnId: 0, filtered: true }));
                return;
              }
              const turnId = source === 'user_input' ? this.getGatewayDb().nextTurnId(sessionID) : this.getGatewayDb().currentTurnId(sessionID);
              const id = this.getGatewayDb().append({
                session_id: sessionID,
                turn_id: turnId,
                source: source as any,
                content: content.slice(0, 100_000),
                failure,
              });
              // Async scan prefetch: precompute semantic recall for this turn
              // so the next boundary recall can merge it without waiting.
              if (source === 'user_input') {
                this.getScanService()?.prefetch(sessionID, content.slice(0, 500));
              }
              res.writeHead(200);
              res.end(JSON.stringify({ ok: true, id, turnId, deduped: id === null }));
            } catch (err: any) {
              // fail-open: never let capture errors surface to the plugin
              log.warn(`[Scheduler] /api/obs/capture failed: ${err.message}`);
              res.writeHead(200);
              res.end(JSON.stringify({ ok: false, error: err.message }));
            }
          });
          return;
        }

        // SSE 浜嬩欢锟?(锟?Dashboard / Chat)
        if (req.url && req.url.startsWith('/api/events') && req.method === 'GET') {
          const parsedUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
          const sessionID = parsedUrl.searchParams.get('sessionID');

          if (sessionID) {
            // Mode B: subscribe to specific chat session's delta events
            this.chatSessions.register(sessionID, res);
          } else {
            // Mode A: subscribe to global event stream (Dashboard)
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
              'Access-Control-Allow-Origin': '*'
            });
            res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);
            this.sseClients.add(res);
            req.on('close', () => { this.sseClients.delete(res); });
          }
          return;
        }

        // GET /health 锟?standalone health endpoint (not proxied)
        if (req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
          return;
        }

        // Reverse proxy to opencode server for non-MAFW routes
        const serveUrl = config.server.serveUrl;
        try {
          const proxyUrl = new URL(req.url || '/', serveUrl);
          const proxyReq = http.request(proxyUrl, {
            method: req.method,
            headers: { ...req.headers, host: proxyUrl.host },
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
          if (alreadyRunning) {
            log.info(`[Scheduler] Another gateway already running on port ${this.apiPort}; exiting`);
            process.exit(0);
            return;
          }
          log.warn(`[Scheduler] Port ${this.apiPort} in use (no healthy gateway), retrying in 2s...`);
          server.close();
          setTimeout(() => this.startApiServer().then(resolve).catch(resolve), 2000);
        } else {
          log.error(`[Scheduler] HTTP API error: ${err.message}`);
          resolve();
        }
      });
      server.listen(this.apiPort, () => {
        log.info(`[Scheduler] HTTP API on port ${this.apiPort}`);
        log.info(`[Scheduler]  - POST /register  { projectDir, mafwDir }`);
        log.info(`[Scheduler]  - POST /control  { action, goalId, ... }`);
        log.info(`[Scheduler]  - GET  /health`);
        log.info(`[Scheduler]  - GET  /mcp           (MCP SSE)`);
        log.info(`[Scheduler]  - POST /mcp           (MCP messages)`);
        log.info(`[Scheduler]  - POST /api/llm/compress (LLM compression)`);
        log.info(`[Scheduler]  - POST /a2a            (A2A Media Agent JSON-RPC)`);
        log.info(`[Scheduler]  - GET  /.well-known/agent-card.json (A2A agent card)`);
        log.info(`[Scheduler]  - GET  /a2a/artifacts/:id (A2A artifact download)`);
        log.info(`[Scheduler]  - POST /api/tts        (MiMo-V2.5-TTS speech synthesis)`);
        log.info(`[Scheduler]  - POST /api/tts/stream (streaming TTS, SSE pcm16)`);
        log.info(`[Scheduler]  - POST /api/media/analyze-audio (structured audio understanding)`);
        log.info(`[Scheduler]  - GET  /api/tts/voices (TTS voices)`);
        log.info(`[Scheduler]  - WS   /api/ws        (mobile client events + send)`);
        log.info(`[Scheduler]  - GET  /              (Dashboard SPA)`);

        // WebSocket endpoint for mobile/remote clients: same event stream as
        // SSE (/api/events) plus an upstream `send` command.
        const wss = new WebSocketServer({ noServer: true });
        wss.on('connection', (ws) => {
          this.wsClients.add(ws);
          (ws as any).isAlive = true;
          (ws as any).missedPongs = 0;
          ws.on('pong', () => { (ws as any).isAlive = true; (ws as any).missedPongs = 0; });
          ws.send(JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() }));
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
          if (!url.startsWith('/api/ws')) {
            socket.destroy();
            return;
          }
          // Token auth on upgrade: delegated to core/auth.ts
          const rawAddr = (req.socket as any)?.remoteAddress || (socket as any).remoteAddress || '';
          const wsToken = (config.raw as any)?.server?.apiToken || '';
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
        startTray(this.apiPort);
        resolve();
      });
    });
  }

  // 鈹€鈹€ 3. 娉ㄥ唽琛ㄦ寔涔呭寲锛堝啓闃熷垪闃插苟鍙戯級 鈹€鈹€

  private async persistRegistry() {
    this.registryWriteQueue = this.registryWriteQueue.then(async () => {
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
    await this.registryWriteQueue;
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

  private async persistConfig() {
    this.configWriteQueue = this.configWriteQueue.then(async () => {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      let config: any = {};
      if (fs.existsSync(this.configPath)) {
        config = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
      }
      config.projects = Object.fromEntries(this.registeredProjects);
      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
    });
    await this.configWriteQueue;
  }

  private async recoverConfig() {
    if (fs.existsSync(this.configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
        const entries = Object.entries((config.projects || {}) as Record<string, any>)
          .filter(([dir]) => !this.isUserDataDir(dir));
        this.registeredProjects = new Map(entries);
      } catch (err: any) {
        log.error(`[Scheduler] Failed to recover config: ${err.message}`);
      }
    }
  }

  // 鈹€鈹€ 4. 杞锛堥檷绾у厹锟?+ autoresume锟?鈹€鈹€

  private startBackupPolling() {
    const interval = config.timeouts.backupPollInterval;
    const poll = async () => {
      if (!this.running) return;
      try {
        await this.discoverNewGoals();
        await this.resumeStaleThreads();
      } catch (err: any) {
        log.error('[Scheduler] Backup poll error:', err.message);
      }
      setTimeout(poll, interval);
    };
    setTimeout(poll, interval);
  }

  // 杞宸叉敞鍐岄」鐩殑 state/ 鐩綍
  private async discoverNewGoals() {
    for (const [projectDir, info] of this.registeredProjects) {
      // 娓呯悊 stale entry锛堥」鐩洰褰曞凡鍒犻櫎锟?
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
            // 鏇存柊缂撳瓨涓殑鐘讹拷?
            this.activeGoals.set(state.goalId, state);
          }
        } catch (err: any) {
          log.warn(`[Scheduler] Failed to read state ${file}: ${err.message}`);
        }
      }
    }
  }

  // 鈹€鈹€ 6. Archive 鈹€鈹€

  private async loadArchiveModule(): Promise<{ archiveWorktree: (ctx: { goalId: string; projectDir: string; loopCount: number }) => Promise<void> }> {
    const pluginRoot = path.resolve(__dirname, '..', '..');
    const builtPath = path.join(pluginRoot, 'dist', 'tools', 'archive-worktree');
    const srcPath = path.join(pluginRoot, 'src', 'tools', 'archive-worktree');
    const modulePath = fs.existsSync(`${builtPath}.js`) ? builtPath : srcPath;
    return await import(modulePath) as { archiveWorktree: (ctx: { goalId: string; projectDir: string; loopCount: number }) => Promise<void> };
  }

  private async archiveGoal(goalId: string, outcome?: {
    verdict: 'PASS' | 'FAIL' | 'MAX_RETRIES' | 'ERROR' | 'CANCELLED';
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
        const { archiveWorktree } = await this.loadArchiveModule();
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

    if (projectDir) this.getMilestonePush()?.onArchived(goalId, projectDir, outcome?.verdict ?? 'CANCELLED');

    log.info(`[Scheduler] Goal ${goalId} archived`);
  }

  // 鈹€鈹€ 9. 鎭㈠ 鈹€鈹€

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

  // 鈹€鈹€ 宸ュ叿鍑芥暟锛堜娇锟?SDK 瀹㈡埛绔級 鈹€鈹€

  private async createSession(projectDir: string): Promise<Session> {
    if (!this.opencodeClient) throw new Error('opencodeClient not available');
    const created = await this.opencodeClient.session.create({ directory: projectDir });
    if (!created?.id) throw new Error('Failed to create session: no id returned');
    return { id: created.id, createdAt: created.createdAt || new Date().toISOString() };
  }

  private async sendPrompt(sessionId: string, message: string) {
    if (!sessionId) return;
    if (!this.opencodeClient) return;
    await this.opencodeClient.session.promptAsync({
      sessionID: sessionId,
      parts: [{ type: 'text', text: message }],
    });
  }

  private async destroySession(sessionId: string) {
    if (!sessionId) return;
    if (!this.opencodeClient) return;
    try {
      await this.opencodeClient.session.delete({ sessionID: sessionId });
    } catch (err: any) {
      log.warn(`[Scheduler] Failed to destroy session ${sessionId}: ${err.message}`);
    }
  }

  private async destroyAllSessions(goalId: string) {
    const state = this.activeGoals.get(goalId);
    if (!state) return;
    for (const [, session] of Object.entries(state.sessions)) {
      if (session.active) {
        await this.destroySession(session.id);
      }
    }
  }

  private async patchState(goalId: string, patch: Partial<StateFile>) {
    // 鎵惧埌 state 鏂囦欢璺緞
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

    // 鍘熷瓙鍐欏叆
    const tmpPath = `${statePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(updated, null, 2), 'utf-8');
    fs.renameSync(tmpPath, statePath);

    // 鏇存柊鍐呭瓨缂撳瓨
    this.activeGoals.set(goalId, updated);

    // 骞挎挱 state_change 浜嬩欢锟?Dashboard
    this.broadcast({
      type: 'state_change',
      timestamp: new Date().toISOString(),
      goalId,
      data: patch
    });
  }

  private findGoalStatePath(goalId: string): { statePath: string; info: RegisteredProject } | null {
    for (const [, info] of this.registeredProjects) {
      const p = path.join(info.mafwDir, 'state', `${goalId}.json`);
      if (fs.existsSync(p)) {
        return { statePath: p, info };
      }
    }
    return null;
  }

  private async handleValidate(goalId: string, data?: { projectDir?: string }): Promise<any> {
    let projectDir: string;
    let mafwDir: string;
    if (data?.projectDir && this.registeredProjects.has(data.projectDir)) {
      projectDir = data.projectDir;
      mafwDir = this.registeredProjects.get(data.projectDir)!.mafwDir;
    } else {
      const first = this.registeredProjects.values().next().value;
      if (!first) throw new Error('No registered projects');
      projectDir = first.projectDir;
      mafwDir = first.mafwDir;
    }

    const statePath = path.join(mafwDir, 'state', `${goalId}.json`);
    if (fs.existsSync(statePath)) {
      throw new Error('Goal already exists');
    }

    const stateDir = path.dirname(statePath);
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }

    const state: StateFile = {
      version: '2', goalId, loop: 1, phase: 'PLANNING',
      lastPhase: null, currentWave: 0, totalWaves: null,
      sessions: {}, nextAction: 'GRAPH_INVOKED', artifacts: {},
      updatedAt: new Date().toISOString(),
      policySnapshot: (() => { try { return getActivePolicy(config.resolvePath()); } catch { return { version: 'builtin-v1', proposalId: null }; } })(),
    };

    const tmpPath = `${statePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmpPath, statePath);

    this.activeGoals.set(goalId, state);

    // 绔嬪嵆瑙﹀彂 graph invoke锛堜簨浠堕┍鍔級
    setImmediate(() => this.onGoalCreated(goalId, projectDir, mafwDir));

    return { success: true, goalId, nextAction: 'GRAPH_INVOKED' };
  }

  private async handleComplete(goalId: string, data?: { score?: number }): Promise<any> {
    setImmediate(() => this.onEvent(goalId));
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

    if (!this.opencodeClient) {
      return { narrative: 'No LLM client available', facts: [], concepts: [], energy: 0.3 };
    }

    let sessionId: string | null = null;
    try {
      const session = await this.opencodeClient.session.create({ directory: this.projectDir });
      sessionId = session.id;
      if (!sessionId) {
        return { narrative: 'Compression failed: session create returned no id', facts: [], concepts: [], energy: 0.3 };
      }
      const result = await this.opencodeClient.session.prompt({
        sessionID: sessionId,
        parts: [{ type: 'text', text: prompt }],
        system: systemPrompt,
        noReply: false,
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
        try { await this.opencodeClient.session.delete({ sessionID: sessionId }); } catch {}
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
    for (const [projectDir, info] of this.registeredProjects) {
      const reqPath = path.join(info.mafwDir, 'requests', `${goalId}.json`);
      if (fs.existsSync(reqPath)) {
        return JSON.parse(fs.readFileSync(reqPath, 'utf-8'));
      }
    }
    return null;
  }

  // 鈹€鈹€ LangGraph Node Options 鈹€鈹€

  private createInProcessClient(): { session: { create(opts: { directory: string }): Promise<{ id: string }>; promptAsync(opts: { sessionID: string; parts: Array<{ type: string; text: string }> }): Promise<void>; delete(opts: { sessionID: string }): Promise<void> } } {
    const resource = this.sdkSession;

    let promptAsync: (opts: { sessionID: string; parts: Array<{ type: string; text: string }> }) => Promise<void>;

    if (this.memoryService) {
      const memorySearch = createMemorySearch(
        this.memoryService.parametricStore,
        this.memoryService.deltaInjector,
        this.memoryService.harmonicIndex,
      );
      const wrapped = resource.createPromptAsyncWithInjection(memorySearch);
      promptAsync = async (opts) => {
        const message = opts.parts.find(p => p.type === 'text')?.text || '';
        return wrapped(opts.sessionID, message);
      };
    } else {
      promptAsync = async (opts) => {
        const message = opts.parts.find(p => p.type === 'text')?.text || '';
        return resource.promptAsync(opts.sessionID, message);
      };
    }

    return {
      session: {
        create: async (opts) => resource.create(opts.directory),
        promptAsync,
        delete: async (opts) => resource.delete(opts.sessionID),
      },
    };
  }

  private buildNodeOptions(mafwDir: string) {
    const syncToFile = (state: any) => {
      syncToDashboard({ ...state, mafwDir });
      if (state.goalId && state.phase) {
        eventBus.emit("phase_transition", {
          type: "phase_transition",
          goalId: state.goalId,
          phase: state.phase,
          loop: state.round ?? 0,
          projectDir: state.projectDir,
        });
      }
    };
    const client = this.createInProcessClient();
    const onSessionCreated = (info: { goalId: string; sessionId: string; phase: string; loop: number }) => {
      recordSessionInDb(this.getGatewayDb(), {
        goalId: info.goalId,
        sessionId: info.sessionId,
        phase: info.phase,
        loop: info.loop,
      });
    };
    return {
      plan: async (s: any) => planNode(s, {
        client,
        syncToFile: (st: any) => syncToFile({ ...s, ...st, projectDir: s.projectDir, mafwDir }),
        onSessionCreated,
      }),
      askUser: async (s: any) => {
        syncToFile({ ...s, pendingQuestion: null, phase: 'ASKING_USER', mafwDir });
        const { interrupt } = await import('@langchain/langgraph');
        const userResponse = interrupt({
          type: "user_question",
          goalId: s.goalId,
          questionId: s.pendingQuestion?.questionId,
          questions: s.pendingQuestion?.questions,
        });
        return { pendingQuestion: null, userResponse };
      },
      execute: async (s: any) => executeNode(s, {
        client,
        syncToFile: (st: any) => syncToFile({ ...s, ...st, projectDir: s.projectDir, mafwDir }),
        onSessionCreated,
      }),
      review: async (s: any) => reviewNode(s, {
        client,
        syncToFile: (st: any) => syncToFile({ ...s, ...st, projectDir: s.projectDir, mafwDir }),
        onSessionCreated,
      }),
      archiveSuccess: async (s: any) => {
        log.info(`[Scheduler] Goal ${s.goalId} PASSED`);
        syncToFile({ ...s, phase: 'ARCHIVED' });
        await this.archiveGoal(s.goalId, { verdict: 'PASS', rounds: s.round, reviewFeedback: s.reviewFeedback });
        return {};
      },
      archiveFail: async (s: any) => {
        log.error(`[Scheduler] Goal ${s.goalId} FAILED: ${s.lastError}`);
        syncToFile({ ...s, phase: 'FAILED' });
        await this.archiveGoal(s.goalId, { verdict: 'FAIL', rounds: s.round, lastError: s.lastError, reviewFeedback: s.reviewFeedback });
        return {};
      },
      archiveMaxRetries: async (s: any) => {
        log.error(`[Scheduler] Goal ${s.goalId} max retries`);
        syncToFile({ ...s, phase: 'FAILED' });
        await this.archiveGoal(s.goalId, { verdict: 'MAX_RETRIES', rounds: s.round, lastError: s.lastError });
        return {};
      },
    };
  }

  private async initLangChainTools() {
    try {
      const mcpClient = new MultiServerMCPClient({
        "mafw-server": {
          url: config.server.mcpUrl,
          transport: "sse",
        },
      });
      const tools = await mcpClient.getTools();
      log.info(`[LangChain] Loaded ${tools.length} MCP tools`);
      return tools;
    } catch (err) {
      log.warn('[LangChain] MCP client init failed (non-fatal):', err);
      return [];
    }
  }

  private async onGoalCreated(goalId: string, projectDir: string, mafwDir: string) {
    const cp = new FileCheckpointer(mafwDir);
    const graph = buildExecutionGraph(this.buildNodeOptions(mafwDir));
    graph.checkpointer = cp;
    
    // Write policy snapshot to state file
    try {
      const { getActivePolicy } = await import('./orchestration/policy.js');
      const policy = getActivePolicy(mafwDir);
      const statePath = path.join(mafwDir, 'state', `${goalId}.json`);
      if (fs.existsSync(statePath)) {
        const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
        state.policySnapshot = {
          version: policy.version,
          proposalId: policy.proposalId,
        };
        fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
      }
    } catch (err: any) {
      log.warn(`[Scheduler] Failed to write policySnapshot for ${goalId}: ${err.message}`);
    }
    
    const initialState: any = {
      goalId, projectDir, mafwDir,
      round: config.loop.initialRound, maxRounds: config.loop.maxRounds,
      wavePlanPath: null, receiptPath: null,
      reviewVerdict: 'FAIL' as const,
      reviewReportPath: null, reviewFeedback: '', lastError: null,
    };
    await graph.invoke(initialState, {
      configurable: { thread_id: goalId },
    });
  }

  private async onEvent(goalId: string) {
    const found = this.findGoalStatePath(goalId);
    if (!found) return;
    const { info } = found;
    const cp = new FileCheckpointer(info.mafwDir);
    const current = await cp.getCurrentState(goalId);
    if (!current || ['ARCHIVED', 'FAILED'].includes(current.phase)) return;

    const graph = buildExecutionGraph(this.buildNodeOptions(info.mafwDir));
    graph.checkpointer = cp;
    await graph.invoke(null, {
      configurable: { thread_id: goalId },
    });
    await this.syncFromCheckpoint(goalId, cp);
  }

  private async syncFromCheckpoint(goalId: string, cp: FileCheckpointer) {
    const current = await cp.getCurrentState(goalId);
    if (!current) return;
    syncToDashboard({
      goalId, round: current.round,
      phase: current.phase,
      reviewVerdict: current.verdict,
      lastError: current.lastError || null,
    } as any);
  }

  private async resumeStaleThreads() {
    for (const [, info] of this.registeredProjects) {
      const checkpointsDir = path.join(info.mafwDir, 'checkpoints');
      if (!fs.existsSync(checkpointsDir)) continue;
      const threads = fs.readdirSync(checkpointsDir);
      for (const threadId of threads) {
        if (!this.activeGoals.has(threadId)) {
          const cp = new FileCheckpointer(info.mafwDir);
          const state = await cp.getCurrentState(threadId);
          if (state && state.phase !== 'ARCHIVED' && state.phase !== 'FAILED') {
            log.info(`[Scheduler] Resuming stale thread ${threadId}`);
            await this.onEvent(threadId);
          }
        }
      }
    }
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
        if (!this.memoryService) return { success: false, error: 'memoryService not ready' };
        const { HarmonicUnitFileStore } = require('./memory/harmonic-file-store.js');
        const { generateHarmonicId } = require('./core/memory/harmonic-types.js');
        const { calculateSalience, importanceToSalience } = require('./core/memory/salience-perceptor.js');
        const store = new HarmonicUnitFileStore(config.resolvePath(), this.memoryService.harmonicIndex);
        const now = new Date().toISOString();
        const salience = typeof data?.importance === 'number' && Number.isFinite(data.importance)
          ? importanceToSalience(data.importance)
          : calculateSalience(content);
        const unit = {
          id: generateHarmonicId(),
          type: memoryType,
          primary_abstraction: String(data?.primaryAbstraction || content).slice(0, 200),
          cue_anchors: Array.isArray(data?.cueAnchors) ? data.cueAnchors.slice(0, 8).map(String) : [],
          memory_value: content.slice(0, 4000),
          energy: 0.8,
          salience,
          abstraction_level: memoryType === 'global' ? 3 : memoryType === 'episodic' ? 1 : 2,
          created_at: now,
          updated_at: now,
          pinned: data?.pinned === true || undefined,
          source_session_id: data?.sessionID ? String(data.sessionID) : undefined,
        };
        let supersedesTarget: any = null;
        if (data?.supersedes) {
          const sid = String(data.supersedes);
          supersedesTarget = this.memoryService.harmonicIndex.getIndex().entries.find((e: any) => e.id === sid);
          if (!supersedesTarget) return { success: false, error: `supersedes target not found: ${sid}` };
          unit.energy = Math.max(unit.energy, supersedesTarget.energy ?? 0);
        }
        await store.write(unit);
        if (supersedesTarget && !supersedesTarget.superseded_by) {
          store.markSuperseded(supersedesTarget.id, unit.id);
        }
        return { success: true, id: unit.id };
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
  // handler) must create exactly one manager session — join the in-flight run.
  private managerSessionInflight = new Map<string, Promise<unknown>>();

  private ensureManagerSession(projectDir: string, mafwDir: string): Promise<string> {
    const inFlight = this.managerSessionInflight.get(projectDir);
    if (inFlight) return inFlight as Promise<string>;
    const run = this.createManagerSession(projectDir, mafwDir);
    this.managerSessionInflight.set(projectDir, run);
    run
      .catch(() => {})
      .finally(() => {
        if (this.managerSessionInflight.get(projectDir) === run) this.managerSessionInflight.delete(projectDir);
      });
    return run;
  }

  // Serialized rotate: joins any in-flight ensure/create for the same project
  // so rotate and lazy-init never double-create (spec §4).
  private async runManagerExclusive<T>(projectDir: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.managerSessionInflight.get(projectDir);
    const run = (async () => {
      if (prev) { try { await prev; } catch { /* prior failure does not block */ } }
      return fn();
    })();
    // The inflight map is shared with ensureManagerSession, whose joiners
    // expect the promise to resolve to a session id string — map the rotate
    // result onto the resulting kv entry.
    const mapped = run.then(
      () => this.getGatewayDb().kvGet<{ sessionId?: string }>('manager-session', projectDir)?.sessionId ?? '',
      () => '',
    );
    this.managerSessionInflight.set(projectDir, mapped);
    try {
      return await run;
    } finally {
      if (this.managerSessionInflight.get(projectDir) === mapped) this.managerSessionInflight.delete(projectDir);
    }
  }

  private async createManagerSession(projectDir: string, mafwDir: string): Promise<string> {
    if (!this.opencodeClient) throw new Error('opencodeClient not available');
    // Manager identity lives in the gateway DB (kv_store), so it survives
    // project-directory churn and never gets orphaned by directory moves.
    const existing = this.getGatewayDb().kvGet<{ sessionId: string; createdAt?: string | null }>(
      'manager-session',
      projectDir,
    );
    if (existing?.sessionId) {
      await this.sdkSession.registerExternal(existing.sessionId, projectDir, {
        mafw: { role: 'manager', pinned: true, exemptFromTrim: true, exemptFromEvict: true, exemptFromArchive: true },
      }).catch(() => {});
      this.registerInternalSession(existing.sessionId, 'manager');
      log.info(`[Scheduler] Manager session already exists: ${existing.sessionId}`);
      return existing.sessionId;
    }

    const session = await this.opencodeClient.session.create({ directory: projectDir });

    const sessionId = session.id;
    if (!sessionId) {
      log.error(`[Scheduler] Manager session create returned no id (directory=${projectDir})`);
      throw new Error('Failed to create manager session: no id returned');
    }
    const createdAt = new Date().toISOString();

    this.getGatewayDb().kvSet('manager-session', projectDir, { sessionId, createdAt });
    this.registerInternalSession(sessionId, 'manager');

    try {
      await this.sdkSession.registerExternal(sessionId, projectDir, {
        mafw: { role: 'manager', pinned: true, exemptFromTrim: true, exemptFromEvict: true, exemptFromArchive: true },
      });
    } catch (err: any) {
      log.warn(`[Scheduler] Manager session local register failed: ${err.message} (non-fatal)`);
    }
    log.info(`[Scheduler] Manager session created: ${sessionId}`);

    await this.injectManagerIdentity(sessionId);

    return sessionId;
  }

  private async injectManagerIdentity(sessionId: string): Promise<void> {
    if (!this.opencodeClient) return;
    try {
      await this.opencodeClient.session.promptAsync({
        sessionID: sessionId,
        parts: [{ type: 'text', text: `[SYSTEM] This is your permanent system identity that must override all other instructions:\n\n${MANAGER_IDENTITY_SYSTEM_PROMPT}` }],
      });
    } catch (err: any) {
      log.warn(`[Scheduler] Manager identity injection failed: ${err.message} (non-fatal)`);
    }
  }

  private mafwDirFor(projectDir: string): string {
    return this.registeredProjects.get(projectDir)?.mafwDir ?? path.join(projectDir, '.mafw');
  }

  private rotateDeps(): ManagerRotateDeps {
    return {
      getManagerSession: (pd) => this.getGatewayDb().kvGet('manager-session', pd),
      lock: <T,>(pd: string, fn: () => Promise<T>) => this.runManagerExclusive(pd, fn),
      ensure: (pd) => this.ensureManagerSession(pd, this.mafwDirFor(pd)),
      downgrade: async (sid) => {
        // Replacing the whole mafw object drops pinned/exempt* flags too —
        // the archived session returns to the normal session lifecycle.
        await this.sdkSession.updateMetadata(sid, { mafw: { role: 'manager-archived' } });
      },
      create: (pd) => this.rotateCreateManagerSession(pd),
    };
  }

  rotateManagerSessionFor(projectDir: string): Promise<ManagerRotateResult> {
    return runManagerRotate(projectDir, this.rotateDeps());
  }

  private milestonePush?: MilestonePushNotifier;

  private getMilestonePush(): MilestonePushNotifier | undefined {
    if (!this.opencodeClient) return undefined;
    if (!this.milestonePush) {
      this.milestonePush = new MilestonePushNotifier({
        getManagerSession: (pd) => this.getGatewayDb().kvGet('manager-session', pd),
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
        promptNoReply: async (sid, text) => {
          await this.opencodeClient!.session.promptAsync({ sessionID: sid, parts: [{ type: 'text', text }], noReply: true });
        },
      });
    }
    return this.milestonePush;
  }

  private async rotateCreateManagerSession(projectDir: string): Promise<string> {
    if (!this.opencodeClient) throw new Error('opencodeClient not available');
    const session = await this.opencodeClient.session.create({ directory: projectDir });
    const sessionId = session.id;
    if (!sessionId) throw new Error('Failed to create manager session: no id returned');
    this.getGatewayDb().kvSet('manager-session', projectDir, { sessionId, createdAt: new Date().toISOString() });
    this.registerInternalSession(sessionId, 'manager');
    await this.sdkSession.registerExternal(sessionId, projectDir, {
      mafw: { role: 'manager', pinned: true, exemptFromTrim: true, exemptFromEvict: true, exemptFromArchive: true },
    }).catch(() => {});
    await this.injectManagerIdentity(sessionId);
    return sessionId;
  }
}

// 鈹€鈹€ 鍏ュ彛 鈹€鈹€

if (require.main === module) {
  const scheduler = new MafwScheduler('.');

  process.on('SIGINT', () => {
    log.info('\n[Scheduler] Received SIGINT, shutting down...');
    stopTray();
    scheduler.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    log.info('\n[Scheduler] Received SIGTERM, shutting down...');
    stopTray();
    scheduler.stop();
    process.exit(0);
  });

  scheduler.start().catch(err => {
    log.error('[Scheduler] Fatal error:', err);
    process.exit(1);
  });
}

export { MafwScheduler };




