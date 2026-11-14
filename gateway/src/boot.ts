/**
 * Gateway boot sequence (D3 Task 5, ruling D3-R6).
 *
 * `MafwScheduler.start()` moved here VERBATIM as `bootKernel(kernel)`. The class
 * keeps a one-line `start()` delegate; `index.ts` keeps the `require.main` entry.
 *
 * D3-R6 is deliberately *extract-as-is*: the 27 stepped blocks keep their exact
 * original order and inline comments. `BOOT_STEPS` declares that same sequence
 * with each step's prerequisites so the dependency graph is reviewable, but it is
 * a DECLARATION only — nothing asserts it against the live call order and no
 * block was reordered behind a dependency check. Reordering is a separate
 * follow-up decision (spec §4 behavior equivalence).
 *
 * Known smell, documented not fixed: step `services.init` (`initServices()`)
 * opens the unified gateway DB (`getGatewayDb()` constructs the EventStore and
 * runs the event_log frame migration), while step `gatewaydb.migrate` imports
 * the legacy files into that DB afterwards. The DB is therefore open BEFORE the
 * file→DB migration runs. Every migration step is idempotent and fails open, and
 * the legacy inputs are read from disk after the handle exists, so the order is
 * harmless today — but it is an order smell. Fixing it means constructing the DB
 * behind the migration, which changes startup ordering: out of D3 scope.
 *
 * Cycle safety: `BootKernel` is a TYPE-ONLY interface. The kernel instance is
 * passed as a value by `index.ts`, but this module never imports the kernel or
 * the entry at runtime (`import type` only). Instance ownership, self-update and
 * the startup migrations live here as named functions; the kernel keeps thin
 * delegates only where other code or scanner tests still call the method
 * (`persistRegistry` from transport/discovery, `releaseInstanceOwnership` from
 * `stop()`/`shutdown()`, `exitAfterPortConflict` from `startApiServer()`).
 *
 * `__dirname` stays `dist/`: this file is emitted next to `index.js` at the tsc
 * outDir root, so `loadGatewayReleaseMetadata(__dirname)` and the lazy
 * `./recall/*.js` imports keep resolving exactly as they did from the class.
 *
 * Spec: 2026-11-09-gateway-kernel-microkernel-design.md §5.1/§5.5.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import { config } from './config';
import { log } from './core/utils/logger';
import {
  createGatewayRuntimeIdentity,
  loadGatewayReleaseMetadata,
  type GatewayReleaseMetadata,
  type GatewayRuntimeIdentity,
} from './release-info';
import { claimGatewayInstance } from './runtime/instance-ownership';
import type { InstanceLock, InstanceLockHeartbeatHandle } from './runtime/instance-lock';
import { startInstanceLockHeartbeat } from './runtime/instance-lock';
import type { TimerHandle, TimerService } from './core/timer-service';
import {
  gatewayDiscoveryPath,
  publishGatewayDiscovery,
  readGatewayDiscovery,
  type GatewayDiscoveryHandle,
  type GatewayDiscoveryRecord,
} from './runtime/gateway-discovery';
import { mafwRuntimeDir } from './runtime/runtime-paths';
import { QuestionLedger } from './core/manager/question-ledger';
import { shouldEnsureLeadOnStartup } from './core/manager/lead-session-resolution';
import { NodeDriver, type GoalProbePort } from './core/goal/driver';
import { loadGoalState } from './core/goal/state-v3';
import { resolveNodeModel } from './core/goal/node-model';
import { PodStore } from './core/pod/pod-store';
import { PodService } from './core/pod/pod-service';
import { PodMemoryService } from './core/pod/pod-memory-service';
import { PodGoalService } from './core/pod/pod-goal-service';
import { PodSessionLifecycle } from './core/pod/pod-session-lifecycle';
import { PodWorktreeService } from './core/pod/pod-worktree-service';
import { PodMessageDelivery } from './core/pod/pod-message-delivery';
import { PodContextSelectionService } from './mcp/handlers/pod-context-select';
import { canonicalProjectDir, podInternalSessionRoleForNode } from './core/pod/pod-identity';
import { recordSessionInDb } from './core/engine/phase-orchestrator';
import { eventBus } from './event-bus';
import { MutexQueue } from './concurrency/mutex-queue';
import { AutomationEngine } from './automation-engine';
import { MemoryService } from './memory/service';
import { GatewayDatabase } from './memory/gateway-db';
import { TaskService } from './runtime/task-service';
import { SdkSessionResource } from './runtime/sdk-session';
import { structuredOutput } from './runtime/structured-output';
import type { RuntimeCapabilities } from './runtime/contract';
import { RuntimePluginLoader } from './runtime/loader';
import { PI_CAPABILITIES, createPiDefinition, setPiUnknownRecorder } from './runtime/pi-adapter';
import type { RuntimeFactoryContext } from '@mafw/runtime-contract';
import { createOpencodeDefinition, opencodeExternalMode, type OpencodeVariant } from './runtime/opencode-adapter';
import { builtinAdapterRegistrations } from './runtime/builtin-adapters';
import type { RuntimeFacade, RuntimeHost } from './runtime/runtime-facade';
import type { IdentityRegistry } from './runtime/identity-registry';
import { UnknownEventTracker } from './runtime/event-telemetry';
import { PluginHost } from './plugins/package-host';
import type { PluginEventFrame } from './plugins/plugin-events';
import { PackageStateStore } from './plugins/package-state-store';
import { PackageManager } from './plugins/package-manager';
import { PluginSafety } from './plugins/plugin-safety';
import { PluginDoctor } from './plugins/plugin-doctor';
import { PluginAuditStore } from './plugins/plugin-audit-store';
import type { PluginClientSnapshot } from './plugins/client-descriptor';
import { createPluginPackageContext } from './plugins/package-context';
import type { UsageStatsProvider } from './usage/plugin-context';
import { TerminalService } from './terminal/terminal-service';
import { ensureGlobalOfficeSkill } from './core/office/global-skill';
import { ensurePluginCreatorSkill } from './skills/plugin-creator-skill-install';
import { ensurePiModels } from './core/media/pi-models';
import { startTokenWatcher, readRestartInfo, markRestartNotified } from './self-update';

/** The kernel-local `RegisteredProject` subset the boot body reads. */
interface RegisteredProjectInfo {
  projectDir: string;
  mafwDir: string;
}

/**
 * The kernel surface the boot sequence reads or mutates.
 *
 * TYPE-ONLY: `index.ts` passes the live `MafwScheduler` instance, so every field
 * is a live reference (no value capture) — reassigned slots (`releaseMetadata`,
 * `runtime`, `instanceLock`, `goalDriver`, …) stay writable here exactly as they
 * are on the class.
 *
 * `RegisteredProject` / `StateFile` are local interfaces of the kernel module and
 * are intentionally not exported; the boot body only needs the subset below.
 */
export interface BootKernel {
  // ── identity / lifecycle flags ──
  projectDir: string;
  mafwDir: string;
  apiPort: number;
  serveUrl: string;
  serveInstance?: { url: string; close: () => void };
  serveOwned: boolean;
  registryPath: string;
  registryWriteQueue: MutexQueue;
  releaseMetadata: GatewayReleaseMetadata | null;
  runtimeIdentity: GatewayRuntimeIdentity | null;
  runtime: RuntimeFacade | null;
  runtimeName: string;
  runtimeNameBeforeSwitch: string | null;
  runtimeHost: RuntimeHost | null;
  runtimeLoader?: RuntimePluginLoader;
  /** live getter on the kernel (`runtimeDiagnostics?.capabilities ?? fallback`). */
  runtimeCaps: RuntimeCapabilities;
  identityRegistry: IdentityRegistry;
  unknownEventTracker: UnknownEventTracker;
  sdkSession: SdkSessionResource;
  taskService: TaskService;
  memoryService?: MemoryService;
  usageStatsProvider?: UsageStatsProvider;
  automationEngine?: AutomationEngine;
  trajectoryCollector: import('./trajectory/collector').TrajectoryCollector | null;
  goalDriver: NodeDriver | null;
  goalDriverMafwDirCache: Map<string, string>;
  activeGoals: Map<string, any>;
  registeredProjects: Map<string, RegisteredProjectInfo>;
  podPendingHandoffs: Map<string, string[]>;

  // ── instance ownership / discovery ──
  instanceLock: InstanceLock | null;
  /** E1-1: 10s unref'd lease heartbeat owned by boot, cleared on release. */
  instanceLockHeartbeat: InstanceLockHeartbeatHandle | null;
  instanceDiscovery: GatewayDiscoveryHandle | null;
  /** E8-1: discovery heartbeat 走 kernel TimerService（名字 `discovery:heartbeat`）。 */
  discoveryHeartbeatTimer: TimerHandle | null;
  /** E4-1: kernel 命名定时器台账（boot 的唯一长驻 timer 出口）。 */
  timers: TimerService;

  // ── self-update ──
  stopTokenWatcher: (() => void) | null;
  tokenWriterSession: { sessionID: string; at: number } | null;
  lastActiveBySession: Map<string, number>;

  // ── plugin package host ──
  pluginHost?: PluginHost;
  packageStateStore?: PackageStateStore;
  packageManager?: PackageManager;
  bindPluginTrust(input: {
    audit: PluginAuditStore;
    safety: PluginSafety;
    doctor: PluginDoctor;
    packageDir: string;
  }): void;
  pluginClientSnapshot?: PluginClientSnapshot;
  bindPluginAutomation(host: PluginHost): void;
  handlePluginEvent(event: PluginEventFrame): void;
  bindGoalEvalProvider(driver: NodeDriver): void;

  // ── Pod / goal services (populated by initServices) ──
  podStore: PodStore;
  podService: PodService;
  podMemoryService: PodMemoryService;
  podGoalService: PodGoalService;
  podSessionLifecycle: PodSessionLifecycle;
  podWorktreeService: PodWorktreeService;
  podContextSelectionService: PodContextSelectionService;
  podMessageDelivery: PodMessageDelivery;

  // ── kernel methods the boot sequence drives ──
  initServices(): Promise<void>;
  setupEventBus(): void;
  startApiServer(): Promise<boolean>;
  startServe(): Promise<void>;
  startServeWatchdog(): void;
  waitForServeReady(): Promise<void>;
  isServeHealthy(): Promise<boolean>;
  sleep(ms: number): Promise<void>;
  subscribeToEvents(): Promise<void>;
  recoverRegistry(): Promise<void>;
  recoverState(): Promise<void>;
  materializeIdentities(): Promise<void>;
  setRuntimeDiagnostics(): void;
  createRuntime(): Promise<RuntimeFacade>;
  buildGoalProbePort(): GoalProbePort;
  /** canonical event vocabulary (module const in the kernel; exposed for boot). */
  canonicalTypes(): ReadonlySet<string>;
  archiveGoal(goalId: string, outcome?: any): Promise<void>;
  attachBudgetGuardForGoal(goalId: string, sessionID: string, mafwDir: string): void;
  backfillManagerSessionSlots(): void;
  broadcast(event: { type: string; [key: string]: any }): void;
  ensureManagerSession(projectDir: string, mafwDir: string): Promise<string>;
  getGatewayDb(): GatewayDatabase;
  getTerminalService(): TerminalService;
  onPodGoalNode(p: any): void;
  readManagerSessionEntry(projectDir: string): { sessionId: string; createdAt?: string | null } | null;
  recordTranslationDrop(runtime: string, type: string, kind: 'unmatched' | 'suppressed'): void;
  recordTranslationError(runtime: string, kind: 'transformEvent' | 'normalizeMessages', reason: string): void;
  registerInternalSession(sessionId: string, role: string, identity?: string): void;
  restoreWorkerState(): void;
  runtimeGetApiKey(provider: string): string | null;
  /** Adapter-declared user-level skills dir (`discovery.roots().skillRoots[0]`). */
  skillsDir(): string;
  startBackupPolling(): void;
  stop(): void;
  watchAutomationsDir(): void;
  watchConfigFile(): void;
  watchEventsDir(): void;
  watchRegistryDir(): void;
}

/** One boot block: `name` plus the names of the blocks it reads state from. */
export interface BootStep {
  name: string;
  requires: string[];
}

/**
 * The 27 stepped blocks of `start()`, in execution order (census table order).
 *
 * Declaration only (D3-R6): this table is NOT asserted against the code below.
 * It exists so the implicit dependency graph is reviewable and so a later wave
 * can introduce the checks without re-deriving them from a 600-line function.
 */
export const BOOT_STEPS: readonly BootStep[] = [
  { name: 'boot.metadata', requires: [] },
  { name: 'instance.ownership', requires: [] },
  { name: 'services.init', requires: ['instance.ownership'] },
  { name: 'shipped.assets', requires: ['services.init'] },
  { name: 'eventbus.setup', requires: ['services.init'] },
  { name: 'question-ledger.reconcile', requires: ['services.init'] },
  { name: 'http.listen', requires: ['services.init', 'eventbus.setup'] },
  { name: 'instance.discovery', requires: ['http.listen', 'boot.metadata'] },
  { name: 'runtime.loader', requires: ['http.listen'] },
  { name: 'plugin.host', requires: ['runtime.loader'] },
  { name: 'runtime.activate', requires: ['runtime.loader', 'plugin.host'] },
  { name: 'serve.ensure', requires: ['runtime.activate'] },
  { name: 'serve.watch', requires: ['serve.ensure'] },
  { name: 'registry.recover', requires: ['services.init'] },
  { name: 'datadir.migrate', requires: ['registry.recover'] },
  { name: 'gatewaydb.migrate', requires: ['registry.recover', 'datadir.migrate'] },
  { name: 'constraints.migrate', requires: ['registry.recover'] },
  { name: 'legacy-t1.archive', requires: ['registry.recover'] },
  { name: 'identities.materialize', requires: ['runtime.activate'] },
  { name: 'goal.driver', requires: ['identities.materialize', 'gatewaydb.migrate'] },
  { name: 'state.recover', requires: ['goal.driver', 'gatewaydb.migrate'] },
  { name: 'lead.ensure', requires: ['state.recover'] },
  { name: 'automation.start', requires: ['state.recover'] },
  { name: 'worker.restore', requires: ['state.recover'] },
  { name: 'backup.poll', requires: ['state.recover'] },
  { name: 'watchers', requires: ['state.recover'] },
  { name: 'self-update.watch', requires: ['http.listen'] },
];

/**
 * Run the gateway boot sequence: identity → instance lease → HTTP → runtime →
 * serve → registry/migrations → goal state → watchers. Extract-as-is (D3-R6).
 */
export async function bootKernel(kernel: BootKernel): Promise<void> {
  log.info('MAFW Scheduler v5.0 starting...');
  kernel.releaseMetadata = loadGatewayReleaseMetadata(__dirname);
  kernel.runtimeIdentity = createGatewayRuntimeIdentity(process.env, () => randomUUID());
  log.info(
    `[Scheduler] release v${kernel.releaseMetadata.gatewayVersion}`
    + ` (${kernel.runtimeIdentity.distribution}/${kernel.runtimeIdentity.channel})`
    + ` instance=${kernel.runtimeIdentity.instanceId}`,
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
  kernel.instanceLock = ownership.lock;
  // E1-1: the lease must stay fresh while we run. Without this loop a live
  // owner's heartbeat ages past the 30s stale window and a contender reaps a
  // gateway that is still serving. unref'd: the timer alone never holds the
  // process open; `releaseInstanceOwnership()` clears it.
  kernel.instanceLockHeartbeat = startInstanceLockHeartbeat(ownership.lock, {
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`[Scheduler] instance lock heartbeat failed: ${message}`);
    },
  });
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
  await kernel.initServices();
  // Install the shipped Office skill before serve spawns: opencode builds its
  // skill catalog at startup, so a later write would not be discovered.
  try {
    const skill = await ensureGlobalOfficeSkill({ skillsDir: kernel.skillsDir() });
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
    const skill = await ensurePluginCreatorSkill({ skillsDir: kernel.skillsDir() });
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
  kernel.setupEventBus();

  // Boot reconcile: orphan questions for inactive goals
  const bootLedger = new QuestionLedger(kernel.mafwDir);
  const activeCheckpoints = new Set(Array.from(kernel.activeGoals.keys()));
  bootLedger.bootReconcile(activeCheckpoints);

  // 1. Start HTTP API immediately (health check endpoint, MCP, etc.)
  const listening = await kernel.startApiServer();
  if (!listening) {
    await releaseInstanceOwnership(kernel);
    process.exit(1);
    return;
  }
  try {
    await publishInstanceDiscovery(kernel);
  } catch (err: any) {
    log.error(`[Scheduler] gateway discovery publish failed: ${err?.message ?? err}`);
    await releaseInstanceOwnership(kernel);
    process.exit(1);
    return;
  }

  // 2. 初始化 runtime 插件加载器
  kernel.runtimeLoader = new RuntimePluginLoader(config.resolvePath('runtime-plugins'));
  kernel.runtimeLoader.setCanonicalTypes(kernel.canonicalTypes());
  await kernel.runtimeLoader.init();
  // 内置 pi runtime 注册：实现已抽到 `@mafw/adapter-pi`（adapters/pi），
  // gateway 只经 `runtime/pi-adapter.ts` 的包入口调用。
  kernel.runtimeLoader.registerBuiltinDefinition(
    'pi',
    (ctx) => createPiDefinition(ctx),
    { external: false, capabilities: PI_CAPABILITIES },
  );
  // pi 原生未知事件 → 统一遥测。翻译在 adapter 的 pi-adapter-events 内完成，
  // 未映射类型由该模块的 recorder 上报（gateway 不再有 transform fallthrough）。
  setPiUnknownRecorder((t) => { try { kernel.unknownEventTracker.record('pi', t); } catch { /* fail-open */ } });

  // 2b. 统一插件包宿主（必须在 createRuntime 之前 init——包 runtime 贡献要先注册）
  const pluginPackageDir = process.env.MAFW_PLUGINS_DIR || config.resolvePath('plugins');
  kernel.packageStateStore = new PackageStateStore(config.resolvePath());
  kernel.pluginHost = new PluginHost(
    pluginPackageDir,
    (name, bag) => createPluginPackageContext(name, {
      getApiKey: kernel.runtimeGetApiKey.bind(kernel),
      usageStats: () => kernel.usageStatsProvider,
      projectDir: kernel.projectDir,
      gatewayPort: config.server.apiPort,
      // ctx.effect 的清理挂在本 candidate 的 RegistrationBag：reload/replace/
      // disable/delete/离线 check 时统一执行（LIFO）。
      bag,
      // ctx.terminal 复用桌面终端同一个 TerminalService（惰性：runtime 热切换
      // 与「无 PTY 能力」都在调用时现读）。PTY 归属目录由插件按请求票据传入。
      terminal: () => kernel.getTerminalService(),
      emit: (event) => kernel.broadcast(event),
      // 包只能改 plugins.<package>.config——context 负责收敛命名空间与
      // 补丁安全校验，这里只透传到既有的 config.persistOverrides。
      persistConfig: (overrides) => {
        config.persistOverrides(overrides as unknown as Parameters<typeof config.persistOverrides>[0]);
      },
    }),
    {
      // 变更包若拥有当前 active runtime → 整包 pending，不打断正在使用的工作。
      activeRuntime: () => kernel.runtimeName,
      // 管理器独立持久化的禁用状态：包仍在磁盘上，但扫描时跳过。
      isDisabled: (name) => kernel.packageStateStore!.isDisabled(name),
      // 包事件不得冒充 canonical 事件。
      canonicalTypes: kernel.canonicalTypes(),
      // 包事件 + 提交后的 plugins.changed 走 gateway 既有扁平广播通道。
      broadcast: (event) => kernel.broadcast(event as any),
      // 插件事件作为 automation external trigger 的只读入口。
      onEvent: (event) => kernel.handlePluginEvent(event),
    },
  );
  kernel.bindPluginAutomation(kernel.pluginHost);
  kernel.packageManager = new PackageManager({
    pluginDir: pluginPackageDir,
    host: kernel.pluginHost,
    stateStore: kernel.packageStateStore,
  });
  const pluginAudit = new PluginAuditStore(kernel.getGatewayDb());
  const pluginSafety = new PluginSafety({
    state: kernel.packageStateStore,
    host: kernel.pluginHost,
    audit: pluginAudit,
    oneRunSafeMode: process.env.MAFW_SAFE_MODE === '1',
  });
  const hostVersion = process.env.MAFW_HOST_VERSION
    ?? (() => { try { return String(require('../../package.json').version); } catch { return '0.0.0'; } })();
  const pluginDoctor = new PluginDoctor({
    pluginDir: pluginPackageDir,
    host: kernel.pluginHost,
    state: kernel.packageStateStore,
    hostVersion,
  });
  kernel.bindPluginTrust({
    audit: pluginAudit,
    safety: pluginSafety,
    doctor: pluginDoctor,
    packageDir: pluginPackageDir,
  });
  kernel.pluginHost.bindRuntime((entries) => kernel.runtimeLoader?.setPackageEntries(entries));
  // 客户端快照只在 commit 后替换；handler/源码永不下发。
  kernel.pluginHost.onSnapshot((snapshot) => { kernel.pluginClientSnapshot = snapshot; });
  await kernel.pluginHost.init();

  // 3. 创建 SDK 客户端（auth），用于健康检查和后续通信
  const sdkConfig = {
    baseUrl: kernel.serveUrl,
    headers: {} as Record<string, string>,
  };
  // Serve credentials are adapter-owned (`resolveServePassword`); the gateway
  // only forwards host-provided headers through `host.proxyHeaders()`.
  // opencode 注册为正式内置插件（与用户插件同一接口；同名文件/包可覆盖）。
  // v2：携带事件翻译声明——opencode 不再有「免翻译特权」，原生流经同一
  // wrap 序列（映射差异行 + transformEvent 前缀丢弃）进 canonical 管线。
  // canonical v3 / Plan 2：方言寻址——裸 `opencode`（自适应：SSE peek 探测，
  // fail-safe @v1）+ 钉死 `opencode@v1` / `opencode@v2`；三个名字共享同一
  // runtime 工厂（serve/adapter/凭据全同），差异仅在事件映射表。
  const sdkSnapshot = { ...sdkConfig, headers: { ...sdkConfig.headers } };
  const external = opencodeExternalMode();
  const opencodeDefinition = (variant: OpencodeVariant, name: string) => (ctx: RuntimeFactoryContext) => {
    return createOpencodeDefinition(ctx, {
      variant,
      registrationName: name,
      baseUrl: sdkSnapshot.baseUrl,
      headers: { ...sdkSnapshot.headers },
      scanEndpoints: (config.recall as any).scanEndpoints || undefined,
      hooks: {
        onUnmatched: (type) => kernel.recordTranslationDrop(name, type, 'unmatched'),
        onSuppressed: (type) => kernel.recordTranslationDrop(name, type, 'suppressed'),
        onTranslationError: (_raw, reason) => kernel.recordTranslationError(name, 'transformEvent', reason),
      },
    });
  };
  // Builtin adapters register from adapter-owned descriptors: the gateway has
  // no per-runtime name/variant branches. The bare name is adaptive; pinned
  // names keep their dialect tables.
  for (const registration of builtinAdapterRegistrations(external)) {
    kernel.runtimeLoader.registerBuiltinDefinition(
      registration.name,
      opencodeDefinition(registration.variant, registration.name),
      registration.options,
    );
  }

  const runtime = await kernel.createRuntime();
  kernel.runtime = runtime;
  kernel.setRuntimeDiagnostics();
  kernel.runtimeNameBeforeSwitch = null;
  try { await kernel.taskService.start(); } catch (err: any) {
    log.warn(`[Tasks] start failed (non-fatal): ${err?.message ?? err}`);
  }
  kernel.sdkSession.setClient(kernel.runtime);
  if (kernel.trajectoryCollector) {
    kernel.trajectoryCollector.setRuntime(kernel.runtime);
  }
  if (kernel.automationEngine) {
    kernel.automationEngine.setRuntimeClient(runtime);
  }
  log.info(`Runtime initialized: ${kernel.runtimeName} (capabilities: ${JSON.stringify(kernel.runtimeCaps)})`);

  // 3. Background: connect to OpenCode server
  const isExternal = !!runtime.external;
  let serveReady = false;
  if (isExternal) {
    log.info(`[Scheduler] Using external Runtime serve at ${kernel.serveUrl} (runtime.external=true)`);
    try { await kernel.waitForServeReady(); serveReady = true; }
    catch { log.warn('External Runtime serve not available — MCP-only mode'); }
  } else {
    if (await kernel.isServeHealthy()) {
      log.info('Runtime serve already running (adopted; health-poll watchdog)');
      serveReady = true;
      kernel.serveOwned = false;
      kernel.startServeWatchdog();
    } else {
      log.info('Runtime serve not reachable, checking for stale process...');
      // 清场原语归 runtime（serve 端口是实现细节；无原语的 runtime 无从清场）
      kernel.runtimeHost?.agentProcess?.killServe?.();
      // taskkill /F /T 是异步生效的；给监听 socket 一点释放时间，避免紧随其后的
      // spawn 仍撞 EADDRINUSE 并退化成 MCP-only。
      await kernel.sleep(500);
      try {
        await kernel.startServe();
        serveReady = !!kernel.serveInstance;
      } catch (err) {
        log.error(`Failed to start Runtime serve: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  if (serveReady) {
    // For owned sidecars this starts the health-poll watchdog; for adopted
    // sidecars it is already running and the guard is a no-op.
    kernel.startServeWatchdog();
  }
  // 外部 runtime（如 pi）声明 eventStream 时，事件订阅不等 runtime serve 就绪
  if (serveReady || (kernel.runtimeCaps.eventStream && isExternal)) {
    kernel.subscribeToEvents();
  }

  // 4. Dashboard is now served via the API server on the same port
  //    (the legacy in-process DashboardServer was removed in E3-1).

  // 5. 恢复注册表（权威源：gateway DB kv_store + legacy 文件兜底）
  await kernel.recoverRegistry();

  // 5.0 Data-directory migration: move memory store + pipeline files from
  // the previously-fixed gateway package .mafw (and any project-relative
  // leftovers) to the user-home ~/.mafw data root. Runs before any other
  // migration/watcher so everything downstream reads the new fixed location.
  await migrateDataDirectory(__dirname);

  // 5.0b Reconcile missing merged_from in .harmonic_index.json from OKF
  // frontmatter. Older addEntry() versions omitted this field.
  await reconcileHarmonicIndexMergedFrom();

  // 5.0 File → DB migration for the unified gateway database: rename legacy
  // t1.db, import manager-session files and the reflect cursor, snapshot the
  // registry. Idempotent; every step fails open.
  await migrateGatewayDbAndBackfill(kernel);

  // 5.0a Migrate the legacy pinned-constraints channel into harmonic memory
  // (idempotent; renamed backup marks a project as done).
  await migrateLegacyConstraints(kernel);

  // 5.0a Archive legacy spiral-*.jsonl T1 files (superseded by the SQLite store).
  await archiveLegacyT1(kernel);

  // 5.1 Materialize every registry identity into the runtime's native format
  // (spec 2026-10-08-runtime-neutral-agent-identity §3.2/3.4 — 物化车道 1)。
  // agents.install 的语义即物化：opencode 写 agent md、pi 写 prompts+extension。
  await kernel.materializeIdentities();

  // 5.2 Goal NodeDriver（spec 2026-10-08-goal-orchestration-p1）：state 文件驱动的
  // 编排状态机。client 直连 sdkSession（agent 参数显式绑定身份）；memory 注入由
  // 边界 recall（消息 transform / pi host extension）按每 LLM 调用覆盖，故不再走
  // legacy withMemoryInjection 全量注入。
  kernel.goalDriver = new NodeDriver({
    client: {
      create: async (directory: string) => {
        const rec = await kernel.sdkSession.create(directory);
        return { id: rec.id };
      },
      // W1：节点会话按身份绑模型（v2 会话模型与 agent 解耦，agent md 的
      // model 只对 subagent 工具子会话生效——goal 会话必须显式 switch）。
      // W5a：模型可配置——config.goal.nodeModel 覆盖优先，身份内置兜底。
      bindModel: async (sessionID: string, agent: string) => {
        const model = resolveNodeModel(
          kernel.identityRegistry.get(agent)?.model,
          config.raw.goal?.nodeModel,
        );
        if (!model) return;
        const fn = kernel.runtime?.session.switchModel;
        if (!fn) return;
        await fn({ sessionID, model });
      },
      promptAsync: async (opts) => {
        const text = opts.parts.find((p) => p.type === 'text')?.text ?? '';
        await kernel.sdkSession.promptAsync(opts.sessionID, text, undefined, opts.agent, undefined, opts.outputSchema);
      },
      delete: async (sessionID: string) => {
        await kernel.podService?.snapshotSession(sessionID);
        await kernel.sdkSession.delete(sessionID);
      },
      abort: async (sessionID: string) => { await kernel.runtime!.session.abort({ sessionID }); },
      structured: async (sessionID: string) => structuredOutput.submitted(sessionID) ?? null,
    },
    db: {
      insertNodeRun: (i) => kernel.getGatewayDb().insertNodeRun(i),
      finishNodeRun: (id, p) => kernel.getGatewayDb().finishNodeRun(id, p),
      listNodeRuns: (g) => kernel.getGatewayDb().listNodeRuns(g),
      latestNodeAttempt: (g, r, l, n) => kernel.getGatewayDb().latestNodeAttempt(g, r, l, n),
    },
    ledger: new QuestionLedger(kernel.mafwDir),
    emitNodeEvent: (p) => {
      kernel.broadcast(p as any);
      kernel.onPodGoalNode(p as any);
    }, // 扁平顶层广播（事件信封契约 §5.6）
    emitPhaseTransition: (p) => eventBus.emit('phase_transition', p),
    onSessionCreated: (info) => {
      recordSessionInDb(kernel.getGatewayDb(), info);
      kernel.podService?.bindSession(info.goalId, info.phase as 'plan' | 'probe' | 'execute' | 'review', info.sessionId);
      // Plan reuses the Tech Lead discussion session, which is already
      // internal. Probe/execute/review get their own hidden role here.
      if (info.phase === 'probe' || info.phase === 'execute' || info.phase === 'review') {
        kernel.registerInternalSession(
          info.sessionId,
          podInternalSessionRoleForNode(info.phase),
        );
      }
      const mafwDir = kernel.goalDriverMafwDirCache.get(info.goalId);
      if (mafwDir) kernel.attachBudgetGuardForGoal(info.goalId, info.sessionId, mafwDir);
    },
    archiveGoal: (goalId, opts) => kernel.archiveGoal(goalId, opts as any),
    nodeTimeoutMs: (config as any).goal?.nodeTimeoutMs ?? 30 * 60_000,
    maxAttempts: 2,
    workdirForRevision: async (goalId, revision) => {
      const goal = kernel.podStore?.getGoalByGoalId(goalId);
      if (!goal) return null;
      // No row = legacy/in-flight Goal from before worktree support: never retrofit
      // mid-Goal (its earlier work lives in the project checkout).
      const worktree = await kernel.podWorktreeService.ensureExisting(goal.podId, goalId, revision);
      return worktree?.dir ?? null;
    },
    goalMode: (goalId, revision) => {
      const goal = kernel.podStore?.getGoalByGoalId(goalId);
      if (!goal) return null;
      return kernel.podStore.getGoalRevision(goal.podId, goalId, revision)?.goalMode ?? 'standard';
    },
    newApprovalId: () => `pa_${randomUUID()}`,
    canCreateNode: (goalId: string) => {
      const podId = kernel.podService?.getPodIdForGoal(goalId);
      if (!podId) return true;
      const pod = kernel.podStore?.getPod(podId);
      return !pod || pod.status === 'active' || pod.status === 'idle';
    },
    // W4: plan 节点注入 L1 能力账本 + L2 失败谱（自我认知闭环），fail-open。
    // D4b: 签名带 goalId——读 state.taskType 做同类任务先验。
    capabilityPrior: (goalId: string) => {
      try {
        const { buildCapabilityLedger, buildFailureTaxonomy, capabilityPriorBlock } = require('./orchestration/capability-ledger');
        const ledger = buildCapabilityLedger(kernel.getGatewayDb().listGoalOutcomes({ limit: 200 }));
        const taxonomy = buildFailureTaxonomy(kernel.memoryService?.harmonicIndex.getIndex().entries ?? []);
        return capabilityPriorBlock(ledger, taxonomy) || null;
      } catch {
        return null;
      }
    },
    // D4b: plan 节点注入反事实推演块（pre-mortem）——同类任务失败形态 + riskNote 要求。
    counterfactualPrior: (goalId: string) => {
      try {
        const { counterfactualBlock } = require('./orchestration/capability-ledger');
        const mafwDir = kernel.goalDriverMafwDirCache.get(goalId);
        const taskType = mafwDir
          ? (loadGoalState(mafwDir, goalId)?.taskType ?? 'other')
          : 'other';
        const outcomes = kernel.getGatewayDb().listGoalOutcomes({ limit: 200 });
        const taxonomy = require('./orchestration/capability-ledger').buildFailureTaxonomy(
          kernel.memoryService?.harmonicIndex.getIndex().entries ?? [],
        );
        return counterfactualBlock({ taskType }, outcomes, taxonomy) || null;
      } catch {
        return null;
      }
    },
    podContext: (goalId: string, node: 'plan' | 'execute' | 'review', sessionId: string) => {
      try {
        const podId = kernel.podService?.getPodIdForGoal(goalId);
        if (!podId) return null;
        const claim = kernel.podMessageDelivery?.claimPendingForSession(sessionId) ?? null;
        if (claim) kernel.podPendingHandoffs.set(sessionId, claim.ids);
        const memory = kernel.podMemoryService?.renderContext(podId, node) ?? null;
        return [claim?.block ?? null, memory].filter(Boolean).join('\n\n') || null;
      } catch {
        return null;
      }
    },
    // Task 17：确定性 ContextManifest（阶段基线 + Lead 选入的引用）。legacy/非 Pod Goal
    // 不注入（旧 prompt 零迁移）；Pod Goal 的缺失/敏感引用 fail-closed（driver 归档该节点）。
    contextBlock: async (goalId: string, node: 'plan' | 'probe' | 'execute' | 'review', revision: number) => {
      if (!kernel.podContextSelectionService) return null;
      if (!kernel.podService?.getPodIdForGoal(goalId)) return null;
      return kernel.podContextSelectionService.renderForNode({ goalId, node, revision });
    },
    onPromptDispatched: (sessionId: string) => {
      const ids = kernel.podPendingHandoffs.get(sessionId);
      if (!ids) return;
      kernel.podMessageDelivery?.commitDelivered(ids, sessionId);
      kernel.podPendingHandoffs.delete(sessionId);
    },
    // Task 12/13：plan 复用 Tech Lead 讨论会话（同一 revision 的讨论 → 计划连续性）。
    // 同步、非创建式查找——只有当前 revision 已有活跃讨论租约才命中；讨论回合与
    // 计划回合的 idle 竞态由 driver 的 reuse idle 宽容兜底。
    existingNodeSession: (goalId: string, node: 'plan' | 'execute' | 'review', revision: number) => {
      if (node !== 'plan') return null;
      const podId = kernel.podService?.getPodIdForGoal(goalId);
      if (!podId) return null;
      const member = kernel.podStore?.getMemberByRole(podId, 'tech_lead');
      if (!member) return null;
      const lease = kernel.podStore?.getActiveScopedSession({
        podId, memberId: member.id, goalId, revision, kind: 'discussion',
      }, kernel.runtimeName);
      return lease?.sessionId ?? null;
    },
    // Task 14：两段式 Spike。生产实现 = PodProbeService（持久化/单飞/脱敏）+
    // ProbeWorkspaceFactory（主项目之外的隔离工作区）。
    probes: kernel.buildGoalProbePort(),
  });
  kernel.bindGoalEvalProvider(kernel.goalDriver);

  // 6. 恢复活跃 Goal
  await kernel.recoverState();
  await kernel.podService?.reconcile().catch((err: any) => log.warn(`[Pod] reconcile failed (non-fatal): ${err?.message ?? err}`));
  await kernel.podGoalService?.reconcile().catch((err: any) => log.warn(`[Pod] goal reconcile failed (non-fatal): ${err?.message ?? err}`));
  await kernel.podSessionLifecycle?.retireStaleDiscussionLeases()
    .catch((err: any) => log.warn(`[Pod] session lease reconcile failed (non-fatal): ${err?.message ?? err}`));

  // 7. Lead 只属于已有 Pod 或仍有 in-flight Goal 的项目；Pod-less registered
  // project 不再预建一个没有用户入口的隐藏会话。
  const inFlightDirs = new Set(
    Array.from(kernel.activeGoals.values())
      .map((state: any) => state?.projectDir)
      .filter((dir: unknown): dir is string => typeof dir === 'string' && dir.length > 0)
      .map((dir) => canonicalProjectDir(dir)),
  );
  const leadDirs = new Map<string, RegisteredProjectInfo>();
  for (const [projectDir, info] of kernel.registeredProjects) {
    const canonical = canonicalProjectDir(projectDir);
    if (leadDirs.has(canonical)) continue;
    const hasPod = !!kernel.podStore.getPodByProject(canonical);
    if (!shouldEnsureLeadOnStartup({ hasPod, hasInFlightGoal: inFlightDirs.has(canonical) })) continue;
    leadDirs.set(canonical, info);
  }
  for (const [canonical, info] of leadDirs) {
    try {
      await kernel.ensureManagerSession(canonical, info.mafwDir);
    } catch (err: any) {
      log.warn(`[Scheduler] Lead session init failed for ${canonical}: ${err.message}`);
    }
  }

  // 8. 启动自动化引擎
  if (kernel.automationEngine) {
    kernel.automationEngine.start();
    log.info('[Scheduler] Automation engine started');
  }

  // 8.0 Worker-state recovery: reflect sessions that accumulated unreflected
  // episodes while their workers were evicted (fire-and-forget).
  setTimeout(() => kernel.restoreWorkerState(), 3000);

  // 8. 开始轮询（降级兜底）
  const pollInterval = config.timeouts.backupPollInterval;
  log.info(`[Scheduler] Starting backup polling loop (${pollInterval / 1000}s)...`);
  kernel.startBackupPolling();

  // 9. 监听 events 目录 (替代 HTTP POST /api/events)
  kernel.watchEventsDir();
  // 10. 鐩戝惉 registry 鐩綍 (鏇夸唬 HTTP POST /register)
  kernel.watchRegistryDir();
  // 11. 鐑厛閰嶇疆 (config.yaml / automations)
  kernel.watchConfigFile();
  kernel.watchAutomationsDir();

  // 12. Self-update: watch the restart token and, in takeover mode, notify
  // the caller session that the update completed.
  startSelfUpdateWatcher(kernel);
  if (takeover) {
    await notifyUpdateComplete(kernel);
  }
}

// ── Instance ownership (lease + discovery) ──────────────────────────────────
//
// The lease is held by the process that is about to bind; the discovery record
// is the attach surface for a deferred contender. Ownership release is
// idempotent and best-effort — it never throws on shutdown paths.

/** Bind failed and another MAFW gateway owns the port: release our lease and defer. */
export async function exitAfterPortConflict(kernel: BootKernel, alreadyRunning: boolean): Promise<void> {
  await releaseInstanceOwnership(kernel);
  if (alreadyRunning) {
    process.stdout.write(`${JSON.stringify({
      mafw: 'deferred',
      instance: await readCurrentInstanceDiscovery(),
    })}\n`);
    log.info(`[Scheduler] Another gateway already running on port ${kernel.apiPort}; exiting`);
    process.exit(0);
    return;
  }
  log.error(`[Scheduler] Port ${kernel.apiPort} is occupied by another process; exiting`);
  process.exit(1);
}

export async function readCurrentInstanceDiscovery(): Promise<GatewayDiscoveryRecord | null> {
  try {
    return await readGatewayDiscovery(mafwRuntimeDir());
  } catch {
    return null;
  }
}

export async function publishInstanceDiscovery(kernel: BootKernel): Promise<void> {
  if (!kernel.releaseMetadata || !kernel.runtimeIdentity) return;
  const runtimeDir = mafwRuntimeDir();
  kernel.instanceDiscovery = await publishGatewayDiscovery({
    instanceId: kernel.runtimeIdentity.instanceId,
    pid: process.pid,
    port: kernel.apiPort,
    gatewayVersion: kernel.releaseMetadata.gatewayVersion,
    experienceVersion: kernel.releaseMetadata.experienceVersion,
    minimumClientExperienceVersion: kernel.releaseMetadata.minimumClientExperienceVersion,
    schemaEpoch: kernel.releaseMetadata.schemaEpoch,
    channel: kernel.runtimeIdentity.channel,
    distribution: kernel.runtimeIdentity.distribution,
    origin: process.env.MAFW_GATEWAY_ORIGIN?.trim() || 'standalone',
  }, runtimeDir);
  kernel.discoveryHeartbeatTimer = kernel.timers.every('discovery:heartbeat', 10_000, () => {
    void kernel.instanceDiscovery?.heartbeat().catch((err: any) => {
      log.warn(`[Scheduler] gateway discovery heartbeat failed: ${err?.message ?? err}`);
    });
  });
  log.info(`[Scheduler] gateway discovery published: ${gatewayDiscoveryPath(runtimeDir)} (port ${kernel.apiPort})`);
}

export async function releaseInstanceOwnership(kernel: BootKernel): Promise<void> {
  if (kernel.instanceLockHeartbeat) {
    kernel.instanceLockHeartbeat.stop();
    kernel.instanceLockHeartbeat = null;
  }
  if (kernel.discoveryHeartbeatTimer) {
    kernel.timers.clear(kernel.discoveryHeartbeatTimer);
    kernel.discoveryHeartbeatTimer = null;
  }
  const discovery = kernel.instanceDiscovery;
  const lock = kernel.instanceLock;
  kernel.instanceDiscovery = null;
  kernel.instanceLock = null;
  try { await discovery?.release(); } catch { /* best effort */ }
  try { await lock?.release(); } catch { /* best effort */ }
}

// ── Registry persistence (write-queue serialized) ──────────────────────────

export async function persistRegistry(kernel: BootKernel): Promise<void> {
  await kernel.registryWriteQueue.run('registry', async () => {
    const entries = Array.from(kernel.registeredProjects.entries());
    // Authoritative copy in the gateway DB (kv_store) — survives cwd /
    // projectDir churn because the db lives at the fixed ~/.mafw root.
    try {
      kernel.getGatewayDb().kvSet('registry/snapshot', 'default', entries);
    } catch (err: any) {
      log.warn(`[Scheduler] registry kv persist failed: ${err.message}`);
    }
    // Compatibility mirror at the legacy file location (opencode never
    // reads it; kept so older tooling can inspect registered projects).
    try {
      const dir = path.dirname(kernel.registryPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        kernel.registryPath,
        JSON.stringify(entries, null, 2)
      );
    } catch (err: any) {
      log.warn(`[Scheduler] registry file persist failed: ${err.message}`);
    }
  });
}

// ── Self-update (restart token + completion notice) ─────────────────────────

export function startSelfUpdateWatcher(kernel: BootKernel): void {
  kernel.stopTokenWatcher = startTokenWatcher({
    stop: () => kernel.stop(),
    locateCaller: () => locateCallerSession(kernel),
    onError: (message) => log.info(message),
  });
}

// Deterministic: the token writer's session is pinned by handleRuntimeEvent
// when a tool command touching pending-restart.json was observed; fall back
// to the most recently active session.
export function locateCallerSession(kernel: BootKernel): string | null {
  if (kernel.tokenWriterSession) return kernel.tokenWriterSession.sessionID;
  let best: string | null = null;
  let bestAt = 0;
  for (const [sid, at] of kernel.lastActiveBySession) {
    if (at > bestAt) { bestAt = at; best = sid; }
  }
  return best;
}

// After a self-restart, tell the agent that the update finished: notify the
// recorded caller session only. Goal-state resume semantics belong to the
// caller; cross-project managers gain nothing from this notice (they would
// just burn a round of LLM tokens). If the caller is unknown, fall back to
// the primary project's manager. Failures degrade to the passive protocol.
export async function notifyUpdateComplete(kernel: BootKernel): Promise<void> {
  const info = readRestartInfo();
  if (!info || info.notified) return;
  const elapsed = info.startedAt ? Math.round((Date.now() - new Date(info.startedAt).getTime()) / 1000) : undefined;
  const message = `[MAFW SYSTEM] Gateway \u81ea\u66f4\u65b0\u5df2\u5b8c\u6210\uff08reason: ${info.reason || '-'}${info.commit ? `, commit: ${info.commit}` : ''}${elapsed !== undefined ? `, \u8017\u65f6 ${elapsed}s` : ''}\uff09\u3002goal \u6267\u884c\u72b6\u6001\u5df2\u6301\u4e45\u5316\uff0c\u8bf7\u8bfb\u53d6 goal state \u7684 nextAction \u5e76\u7ee7\u7eed\u6267\u884c\uff1b\u82e5\u65e0\u672a\u5b8c\u6210\u4efb\u52a1\u5219\u65e0\u9700\u989d\u5916\u52a8\u4f5c\u3002`;

  const targets = new Set<string>();
  if (info.sessionID) {
    targets.add(info.sessionID);
  } else {
    try {
      const ms = kernel.readManagerSessionEntry(kernel.projectDir);
      if (ms?.sessionId) targets.add(ms.sessionId);
    } catch { /* skip */ }
  }

  if (!kernel.runtime) return;
  let notified = false;
  for (const sid of targets) {
    try {
      await kernel.runtime.session.promptAsync({
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

// ── Startup migrations (data root, memory index, gateway DB, legacy channels) ─
//
// Each block is the verbatim try/catch from `start()`, lifted into a named
// function so the boot sequence reads as a sequence. Fail-open per block: a
// migration failure logs and boot continues (except where the caller exits).

async function migrateDataDirectory(gatewayRoot: string): Promise<void> {
  try {
    const { migrateDataDir } = await import('./recall/data-dir-migrate.js');
    const res = migrateDataDir(
      config.resolvePath(),
      path.join(gatewayRoot, '..', '.mafw'),
    );
    if (res.migrated) {
      log.info(`[Scheduler] data dir migrated: ${res.moved.join(', ')}; legacy removed: ${res.legacyRemoved}`);
    }
  } catch (err: any) {
    log.warn(`[Scheduler] data dir migration failed (non-fatal): ${err.message}`);
  }
}

async function reconcileHarmonicIndexMergedFrom(): Promise<void> {
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
}

async function migrateGatewayDbAndBackfill(kernel: BootKernel): Promise<void> {
  try {
    const { migrateGatewayDb } = await import('./recall/gateway-db-migrate.js');
    const managerSessions: Array<{ projectDir: string; filePath: string }> = [];
    for (const [, info] of kernel.registeredProjects) {
      managerSessions.push({ projectDir: info.projectDir, filePath: path.join(info.mafwDir, 'manager-session.json') });
    }
    managerSessions.push({ projectDir: kernel.projectDir, filePath: path.join(config.resolvePath(), 'manager-session.json') });
    const res = migrateGatewayDb(
      path.join(config.resolvePath(), 'memory'),
      managerSessions,
      path.join(config.resolvePath(), 'recall-reflect-cursor.json'),
      Object.fromEntries(kernel.registeredProjects),
    );
    if (res.renamed || res.managerSessions > 0 || res.cursorImported) {
      log.info(
        `[Scheduler] gateway-db migrate: renamed=${res.renamed} managerSessions=${res.managerSessions} cursor=${res.cursorImported} registrySnapshot=${res.registrySnapshot}`,
      );
    }
    // I3：迁移之后补齐存量 untagged manager-session 行（一次性打标，幂等）。
    kernel.backfillManagerSessionSlots();
  } catch (err: any) {
    log.warn(`[Scheduler] gateway-db migration failed (non-fatal): ${err.message}`);
  }
}

async function migrateLegacyConstraints(kernel: BootKernel): Promise<void> {
  try {
    const { migrateConstraintsFiles } = await import('./recall/constraints-migrate.js');
    const projectDirs = Array.from(kernel.registeredProjects.values()).map((p) => p.projectDir);
    if (!projectDirs.includes(kernel.projectDir)) projectDirs.unshift(kernel.projectDir);
    const res = await migrateConstraintsFiles(projectDirs);
    if (res.migrated > 0 || res.renamed > 0) {
      log.info(`[Scheduler] constraints migration: ${res.migrated} migrated, ${res.renamed} renamed, ${res.skipped} skipped`);
    }
  } catch (err: any) {
    log.warn(`[Scheduler] constraints migration failed (non-fatal): ${err.message}`);
  }
}

async function archiveLegacyT1(kernel: BootKernel): Promise<void> {
  try {
    const { archiveLegacyT1 } = await import('./recall/legacy-t1-archive.js');
    const projectDirs = Array.from(kernel.registeredProjects.values()).map((p) => p.projectDir);
    if (!projectDirs.includes(kernel.projectDir)) projectDirs.unshift(kernel.projectDir);
    const res = archiveLegacyT1(projectDirs);
    if (res.archived > 0) log.info(`[Scheduler] archived ${res.archived} legacy T1 files across ${res.projects} projects`);
  } catch (err: any) {
    log.warn(`[Scheduler] legacy T1 archival failed (non-fatal): ${err.message}`);
  }
}
