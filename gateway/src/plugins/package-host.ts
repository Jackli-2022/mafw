/**
 * 统一插件包宿主 —— 扫 ~/.mafw/plugins/（单文件包 *.js / 目录包 plugin.json+入口），
 * 激活后把贡献分发给四个 legacy loader（setPackageEntries），并向客户端发布
 * 一个可序列化的 revision 快照。fail-open。
 *
 * 提交模型（spec §10.2）：
 *   scan → 内容指纹 → 只为新增/变化的包激活 candidate（私有 RegistrationBag）
 *   → 全部 candidate 处理完 → 一次性提交（先 dispose 被替换的旧包，再推 loader）
 *   → 发布新的 `<bootId>:<counter>` 快照。
 *
 * 指纹未变的包完全复用旧实例：不重新 activate、不清 timer/cache、不改 revision。
 * 失败 candidate 只记诊断，旧 active descriptor 继续可用。
 * 变更包若拥有当前 active runtime，则整包进入 pending，等显式 applyPending。
 *
 * 优先级（同名）：包 > legacy 目录文件 > 内置。
 */
import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { log } from '../core/utils/logger';
import { createPiPromptAdapter } from '../media/pi-adapter';
import { buildClientDescriptor, buildClientSnapshot, type PluginClientSnapshot } from './client-descriptor';
import { fingerprintPackage } from './package-fingerprint';
import { buildActivatedContributions } from './package-validator';
import { withPluginEmit, withPluginHttp } from './package-context';
import { PluginActionRegistry, type PluginActionInvokeOptions } from './plugin-actions';
import { PluginEventRegistry, type PluginEventFrame } from './plugin-events';
import { createPluginHttpRecorder, createPluginHttpRegistry, type PluginHttpRecorder, type PluginHttpRegistry } from './plugin-http';
import { DEFAULT_WEB_SURFACE_ENTRY, validatePluginWebSurfaces } from './plugin-web-assets';
import { createRegistrationBag, type RegistrationBag } from './registration-bag';
import type {
  ActivatedContributions,
  MediaPackageEntry,
  PackageDescriptor,
  PackageManifest,
  PackageState,
  PluginActionDeclaration,
  PluginContributions,
  PluginEmitEvent,
  PluginObserverEntry,
  PluginPackageContext,
  PluginToolEntry,
  RuntimePackageEntry,
  TtsPackageEntry,
  UnifiedPluginContributions,
  UsagePackageEntry,
} from './package-types';
import type { PcmChunk, TtsEngine, TtsOpts } from '../tts/types';
import {
  parsePackageManifest,
  isHostRangeCompatible,
  type NormalizedPackageManifest,
} from './package-manifest';
import type { WorkerHost } from './worker/worker-host';

const VALID_MODALITIES = new Set(['image', 'video', 'audio']);
const EMPTY_CANONICAL_TYPES: ReadonlySet<string> = new Set();

export interface PluginHostOptions {
  /**
   * Opaque gateway boot id used in revision tokens. Generated per host instance
   * by default; a new instance always means a new generation.
   */
  bootId?: string;
  /** Canonical runtime event vocabulary rejected in package event declarations. */
  canonicalTypes?: ReadonlySet<string>;
  /**
   * Name of the runtime currently in use (thunk, read on every scan). A changed
   * package that owns it is staged as pending instead of interrupting work.
   */
  activeRuntime?: () => string | null | undefined;
  /** RegistrationBag factory (diagnostics/tests may inject a tracking bag). */
  createBag?: () => RegistrationBag;
  /**
   * Manager-owned enabled/disabled state (thunk, read on every scan). A
   * disabled package stays installed but contributes nothing until re-enabled.
   */
  isDisabled?: (name: string) => boolean;
  /**
   * Gateway-wide flat broadcast (SSE + WS + mobile push). Used for registered
   * package events and the `plugins.changed` commit notification; absent in
   * headless/tests, where events are accepted but not delivered.
   */
  broadcast?: (event: PluginEventFrame) => void;
  /** Optional fail-open secondary event sink (automation bridge). */
  onEvent?: (event: PluginEventFrame) => void;
  /** Injected action registry (defaults to a fresh one owned by this host). */
  actionRegistry?: PluginActionRegistry;
  /** Injected event registry (defaults to one bound to `canonicalTypes`). */
  eventRegistry?: PluginEventRegistry;
  /**
   * Injected package HTTP/WS registry (defaults to a fresh one owned by this
   * host). The gateway pulls it back through `getHttpRegistry()` to serve
   * `/api/plugins/<pkg>/api*` and the `/ws/*` upgrade path.
   */
  httpRegistry?: PluginHttpRegistry;
  /** Phase 6B: untrusted packages require a worker host. */
  workerHostFactory?: (
    desc: PackageDescriptor,
    manifest: NormalizedPackageManifest,
    hooks: { emit: (event: PluginEmitEvent) => void },
  ) => WorkerHost;
  /** False (default) keeps untrusted packages fail-closed. */
  workerAvailable?: () => boolean;
  /** Committed content fingerprint used to detect untrusted file drift. */
  installedFingerprint?: (name: string) => string | undefined;
  onUntrustedDrift?: (name: string, reason: string) => void;
  /** Product version used by manifest `host` ranges (default MAFW_HOST_VERSION / 5.1.0). */
  hostVersion?: string;
  /** Safe mode / quarantine: return a reason to skip and deactivate the package. */
  activationBlocked?: (name: string) => string | null;
  /** Phase 6 failure counting: called after a real activation failure. */
  onActivationFailure?: (name: string, reason: string) => void;
  /** Phase 6 success reset: called after a committed activation. */
  onActivationSuccess?: (name: string) => void;
}

export interface PluginPendingState {
  /** Pending candidate token (`<bootId>:<counter>`); not client-visible yet. */
  revision: string;
  /** Set when the pending candidate could not be activated. */
  error?: string;
}

export interface PluginApplyResult {
  applied: boolean;
  revision?: string;
  error?: string;
  /**
   * True when the committed package owns the runtime the gateway is currently
   * using: the caller must switch/re-instantiate the runtime for the new
   * revision to take effect.
   */
  runtimeSwitchRequired?: boolean;
  /**
   * The runtime contribution's declared name (the loader key), which may differ
   * from the package name. Present when `runtimeSwitchRequired`: it is the name
   * the caller must switch to.
   */
  runtimeName?: string;
}

/**
 * Static plane declarations from `plugin.json` (`contributes.gateway`).
 *
 * This is an upper bound, not a plan: `registered ⊆ declared` is enforced,
 * the reverse direction never is (packages register conditionally).
 *
 * Presence is meaningful per plane: an **absent** property means the plane is
 * not declared at all and therefore stays unconstrained, while an **explicitly
 * empty array** is a zero bound (`"actions": []` allows no action at all). A
 * renderer must not collapse the two.
 */
export interface PluginCheckDeclared {
  /** Declared action names; absent = unbounded, `[]` = nothing allowed. */
  actions?: string[];
  /** Declared event types; absent = unbounded, `[]` = nothing allowed. */
  events?: string[];
  /** Declared tool names; absent = unbounded, `[]` = nothing allowed. */
  tools?: string[];
  /** Declared observer ids; absent = unbounded, `[]` = nothing allowed. */
  observers?: string[];
  /** `contributes.gateway.http` when the manifest opts in or out explicitly. */
  http?: boolean;
}

/** Planes a candidate actually tried to register while it was checked. */
export interface PluginCheckRegistered {
  actions: string[];
  events: string[];
  tools: string[];
  observers: string[];
  /** HTTP + WebSocket routes recorded through `ctx.http`. */
  http: number;
}

/** Mutable accumulator handed to a probe activation. */
interface PluginCheckInventory {
  registered: PluginCheckRegistered;
  /**
   * Set where the candidate's contribution set is captured (the raw
   * `activate()` result, or the worker's delivered contributions). A candidate
   * that never produced one — bad manifest, missing entry, identity mismatch,
   * throwing `activate()`, unavailable worker — keeps `false`.
   */
  evaluated: boolean;
}

/**
 * Stable reason a check answered `ok: false`.
 *
 * Consumers (CLI, CI, agents) switch on this instead of matching `error` prose:
 * the value is always one of these literals, never raw error text.
 */
export type PluginCheckFailureCode =
  | 'candidate_missing'
  | 'manifest_invalid'
  | 'entry_missing'
  | 'identity_mismatch'
  | 'contribution_bound'
  | 'activation_failed'
  | 'worker_unavailable';

/** Result of an offline candidate check (nothing is published). */
export interface PluginCheckResult {
  ok: boolean;
  name?: string;
  version?: string;
  /** Contribution kinds of the candidate (`ui`, `actions`, `runtime`, …). */
  contributions?: string[];
  /**
   * Declared-vs-registered inventory: the manifest's static planes next to what
   * `activate()` tried to register. `declared` is absent for legacy packages
   * without a `contributes.gateway` block; `registered` is always reported.
   * Within `declared`, an absent plane is unbounded while an explicit `[]` is a
   * zero bound — see `PluginCheckDeclared`.
   */
  declared?: PluginCheckDeclared;
  registered?: PluginCheckRegistered;
  /**
   * Non-fatal manifest diagnostics (`legacy-permissions`, …). `mafw plugin
   * check --strict` turns a non-empty list into a failure.
   */
  warnings?: string[];
  /**
   * Validated Web surface summary for the pre-install preview.
   *
   * Only present on successful checks of packages that declare
   * `ui.webSurfaces`; the count always reflects the validated descriptors (an
   * unreadable `web/` entry fails the whole check instead of lowering it).
   */
  webSurfaces?: { count: number; rail: boolean };
  /** Phase 6 trust metadata for the install consent UI. */
  apiVersion?: 1 | 2;
  kind?: 'trusted' | 'untrusted';
  permissions?: string[];
  error?: string;
  /**
   * Present only when `ok` is false: the stable failure reason. A successful
   * check never carries a code (there is nothing to classify).
   */
  code?: PluginCheckFailureCode;
  /**
   * `true` when the package's `activate()` returned and its contributions were
   * observed; `false` when the package never produced a contribution set
   * (bad manifest, missing entry, identity mismatch, throwing `activate()`,
   * unavailable worker). A failure *after* the set was captured — e.g. a
   * declared-plane violation — still reports `true`, because `registered` is
   * real evidence of what the package tried to register.
   */
  evaluated?: boolean;
}

export interface PluginRemoveResult {
  removed: boolean;
  revision?: string;
}

interface PackageEntries {
  runtime?: RuntimePackageEntry;
  media?: MediaPackageEntry;
  tts?: TtsPackageEntry;
  usage?: UsagePackageEntry;
}

interface ActivationResult {
  version?: string;
  contributions: string[];
  /** Client-safe DTOs + Host declarations of the same `activate()` result. */
  activated: ActivatedContributions;
  entries: PackageEntries;
  /**
   * Identity of this activation as seen by `ctx.emit`. Registration at commit
   * adopts it, so a late emit from a superseded activation is dropped.
   */
  emitterToken: object;
  /** Routes recorded through `ctx.http` during activation. */
  http: PluginHttpRecorder;
}

interface PackageActivation extends ActivationResult {
  descriptor: PackageDescriptor;
  fingerprint: string;
  bag: RegistrationBag;
}

interface ActivePackage extends PackageActivation {
  /** Committed token shared by every package committed in the same snapshot. */
  revision: string;
}

interface PendingPackage {
  descriptor: PackageDescriptor;
  fingerprint: string;
  /** Token allocated when the candidate was staged. */
  revision: string;
  /** Absent when activation/validation failed; the error is kept for the Hub. */
  activation?: PackageActivation;
  error?: string;
}

interface PackageFailure {
  source: string;
  error: string;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

/** Phase the offline check had reached when it failed. */
type PluginCheckStage = 'candidate' | 'manifest' | 'entry' | 'activation';

/**
 * Error prefixes that mean "the declaration bound was violated", not "the
 * package failed to activate". These are *post*-activation validations: the
 * contribution set was already observed, so they can never be
 * `activation_failed`.
 *
 * The list is closed and contract-owned: every string here is produced by this
 * module and pinned by tests, so adding one is a contract change, not a
 * refactor. Message tails are still never matched.
 */
const DECLARED_PLANE_ERROR_PREFIXES = [
  // buildActivatedContributions() rejected a plane outside `contributes`.
  'invalid contributions:',
  // `contributes.gateway.http` is false, but activate() registered routes.
  'http routes are not declared (contributes.gateway.http is false)',
  // No plugin.json: tools/observers/http would widen the surface undeclared.
  'packages without plugin.json cannot contribute ',
  // Declared web surface whose entry does not resolve on disk.
  'invalid web surfaces:',
] as const;

/**
 * Maps a failed check onto the stable enum.
 *
 * Only structural signals are trusted: the stage the check had reached, plus
 * the closed prefix set above and the two identity/worker prefixes this module
 * owns (`name mismatch:`, `worker_unavailable:`). Message tails are
 * deliberately never matched, so a reworded error cannot change the code.
 *
 * Everything else raised while activating is a plain `activation_failed` —
 * that is the honest answer for a manifest shape, host range or contribution
 * factory the package got wrong at runtime.
 */
function classifyCheckFailure(stage: PluginCheckStage, err: unknown): PluginCheckFailureCode {
  if (stage === 'candidate') return 'candidate_missing';
  if (stage === 'manifest') return 'manifest_invalid';
  if (stage === 'entry') return 'entry_missing';
  const message = describeError(err);
  if (message.startsWith('name mismatch:')) return 'identity_mismatch';
  if (message.startsWith('worker_unavailable:')) return 'worker_unavailable';
  if (DECLARED_PLANE_ERROR_PREFIXES.some((prefix) => message.startsWith(prefix))) {
    return 'contribution_bound';
  }
  return 'activation_failed';
}

function hasUiSlots(ui: ActivatedContributions['ui']): boolean {
  return Object.values(ui).some((slot) => Array.isArray(slot) && slot.length > 0);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Pulls one string identity field out of a declaration array, ignoring junk. */
function namesIn(value: unknown, key: 'type' | 'name' | 'id'): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const entry of value) {
    const name = asRecord(entry)?.[key];
    if (typeof name === 'string' && name.length > 0) names.push(name);
  }
  return names;
}

/**
 * Reads the planes a candidate *tried* to register from its raw `activate()`
 * result, before validation drops anything.
 *
 * A failing check is exactly the case the inventory exists for: the rejected
 * registration is what the author has to see next to the declaration it broke.
 */
function registeredFromRaw(raw: unknown, http: number): PluginCheckRegistered {
  const contributions = asRecord(raw) ?? {};
  return {
    actions: Object.keys(asRecord(contributions.actions) ?? {}),
    events: namesIn(contributions.events, 'type'),
    tools: namesIn(contributions.tools, 'name'),
    observers: namesIn(contributions.observers, 'id'),
    http,
  };
}

/**
 * Static upper bound from `plugin.json`; absent when nothing is declared.
 *
 * Absent planes stay absent (unconstrained) — an explicit `"actions": []` is a
 * zero bound and must survive as `[]`, otherwise the report would tell an author
 * that a rejected action was legal.
 */
function describeDeclared(
  gateway: NonNullable<NormalizedPackageManifest['contributes']>['gateway'],
): PluginCheckDeclared | undefined {
  if (!gateway) return undefined;
  return {
    ...(gateway.actions !== undefined ? { actions: gateway.actions } : {}),
    ...(gateway.events !== undefined ? { events: gateway.events } : {}),
    ...(gateway.tools !== undefined ? { tools: gateway.tools.map((tool) => tool.name) } : {}),
    ...(gateway.observers !== undefined ? { observers: gateway.observers } : {}),
    ...(gateway.http !== undefined ? { http: gateway.http } : {}),
  };
}

export class PluginHost {
  private active = new Map<string, ActivePackage>();
  private pending = new Map<string, PendingPackage>();
  private failures = new Map<string, PackageFailure>();
  private snapshot: PluginClientSnapshot;
  private readonly bootId: string;
  private counter = 0;
  /** Serializes scans and pending applies so two watcher bursts cannot interleave. */
  private queue: Promise<unknown> = Promise.resolve();
  private lastStateSignature: string;
  private stopped = false;
  private watcher?: fs.FSWatcher;
  private dirWatchers = new Map<string, fs.FSWatcher>();
  private debounce?: NodeJS.Timeout;
  /** 当前目录包的子目录绝对路径（refreshDirWatchers 用） */
  private pkgDirs: string[] = [];
  private runtimeCb?: (entries: RuntimePackageEntry[]) => void;
  private mediaCb?: (entries: MediaPackageEntry[]) => void;
  private ttsCb?: (entries: TtsPackageEntry[]) => void;
  private usageCb?: (entries: UsagePackageEntry[]) => void;
  private kernelV2Cb?: (tools: PluginToolEntry[], observers: PluginObserverEntry[]) => void;
  private snapshotCb?: (snapshot: PluginClientSnapshot) => void;
  private stateCb?: () => void;
  private lastRuntime: RuntimePackageEntry[] = [];
  private lastMedia: MediaPackageEntry[] = [];
  private lastTts: TtsPackageEntry[] = [];
  private lastUsage: UsagePackageEntry[] = [];
  private lastTools: PluginToolEntry[] = [];
  private lastObservers: PluginObserverEntry[] = [];
  private readonly createBag: () => RegistrationBag;
  private readonly canonicalTypes: ReadonlySet<string>;
  private readonly broadcast?: PluginHostOptions['broadcast'];
  private readonly onEvent?: PluginHostOptions['onEvent'];
  private readonly actions: PluginActionRegistry;
  private readonly events: PluginEventRegistry;
  private readonly http: PluginHttpRegistry;
  /**
   * Packages whose first activation must not take over the active runtime
   * (manager install/enable). Consumed by the next scan only.
   */
  private stagedNew = new Set<string>();

  constructor(
    private dir: string,
    private createContext: (name: string, bag?: RegistrationBag) => PluginPackageContext,
    private options: PluginHostOptions = {},
  ) {
    this.bootId = options.bootId ?? randomBytes(8).toString('hex');
    this.canonicalTypes = options.canonicalTypes ?? EMPTY_CANONICAL_TYPES;
    this.createBag = options.createBag ?? createRegistrationBag;
    this.broadcast = options.broadcast;
    this.onEvent = options.onEvent;
    this.actions = options.actionRegistry ?? new PluginActionRegistry({
      onDiagnostic: (diagnostic) => log.warn(`[PluginHost] ${diagnostic.packageName} ${diagnostic.code}: ${diagnostic.message}`),
    });
    this.events = options.eventRegistry ?? new PluginEventRegistry({
      canonicalTypes: this.canonicalTypes,
      broadcast: this.broadcast ? (frame) => this.broadcast?.(frame) : undefined,
      onEvent: this.onEvent ? (frame) => this.onEvent?.(frame) : undefined,
      onDiagnostic: (diagnostic) => log.warn(`[PluginHost] ${diagnostic.packageName} ${diagnostic.code}: ${diagnostic.message}`),
    });
    this.http = options.httpRegistry ?? createPluginHttpRegistry({ log });
    this.snapshot = buildClientSnapshot(this.currentToken(), []);
    this.lastStateSignature = JSON.stringify(this.getState());
  }

  bindRuntime(cb: (entries: RuntimePackageEntry[]) => void): void { this.runtimeCb = cb; cb(this.lastRuntime); }
  bindMedia(cb: (entries: MediaPackageEntry[]) => void): void { this.mediaCb = cb; cb(this.lastMedia); }
  bindTts(cb: (entries: TtsPackageEntry[]) => void): void { this.ttsCb = cb; cb(this.lastTts); }
  bindUsage(cb: (entries: UsagePackageEntry[]) => void): void { this.usageCb = cb; cb(this.lastUsage); }

  /**
   * Phase 3.6: publish validated package tools/observers (with their revision)
   * to the live kernel-v2 bridge. Replays the last committed snapshot; an empty
   * array after remove/disable is the unsubscribe signal.
   */
  bindKernelV2(
    cb: (tools: PluginToolEntry[], observers: PluginObserverEntry[]) => void,
  ): void {
    this.kernelV2Cb = cb;
    cb(this.lastTools, this.lastObservers);
  }

  /** Client snapshot subscriber; replays the current snapshot immediately. */
  onSnapshot(cb: (snapshot: PluginClientSnapshot) => void): void {
    this.snapshotCb = cb;
    cb(this.snapshot);
  }

  /** Hub/SSE subscriber; fires whenever the visible package state changes. */
  onStateChanged(cb: () => void): void { this.stateCb = cb; }

  async init(): Promise<void> {
    this.ensureDir();
    await this.reload();
    this.startWatch();
  }

  /** Immutable client-visible projection (active packages only). */
  getClientSnapshot(): PluginClientSnapshot { return this.snapshot; }

  /** Committed action registry (REST/SDK invoke through `invokeAction`). */
  getActionRegistry(): PluginActionRegistry { return this.actions; }

  /** Committed event registry (diagnostics + manual emits). */
  getEventRegistry(): PluginEventRegistry { return this.events; }

  /** Committed package HTTP/WS registry (API dispatch + upgrade wiring). */
  getHttpRegistry(): PluginHttpRegistry { return this.http; }

  /** True when the package currently has a committed revision. */
  isPackageCommitted(name: string): boolean {
    return this.active.has(name);
  }

  /**
   * Directory of a committed directory package, used by the Web asset route.
   *
   * `null` for unknown/pending/failed packages and for single-file packages
   * (they have no `web/` directory by definition).
   */
  getCommittedPackageDir(name: string): string | null {
    return this.active.get(name)?.descriptor.pkgDir ?? null;
  }

  /**
   * Invokes one action of a committed package.
   *
   * Pending candidates are not registered, so their actions answer 404 here
   * until `applyPending` commits them.
   */
  invokeAction(
    packageName: string,
    action: string,
    input: unknown,
    options: PluginActionInvokeOptions = {},
  ): Promise<unknown> {
    return this.actions.invoke(packageName, action, input, options);
  }

  getState(): PackageState[] {
    const names = new Set<string>([
      ...this.active.keys(),
      ...this.pending.keys(),
      ...this.failures.keys(),
    ]);
    const out: PackageState[] = [];
    for (const name of names) {
      const active = this.active.get(name);
      const pending = this.pending.get(name);
      const failure = this.failures.get(name);
      // A failed pending candidate is the only record left on later scans (the
      // `failures` map is rebuilt per scan), so it must own the error too —
      // otherwise the Hub would show "ok" while `getPending` still reports it.
      const error = failure?.error ?? pending?.error;
      const source = active?.descriptor.mainFile
        ?? pending?.descriptor.mainFile
        ?? failure?.source
        ?? '';
      const state: PackageState = {
        name,
        source,
        status: error ? 'error' : 'ok',
        contributions: active?.contributions ?? pending?.activation?.contributions ?? [],
        version: active?.version
          ?? pending?.activation?.version
          ?? active?.descriptor.manifest?.version
          ?? pending?.descriptor.manifest?.version,
        revision: active?.revision,
        pendingRevision: pending?.revision,
        fingerprint: active?.fingerprint,
      };
      const manifest = active?.descriptor.manifest ?? pending?.descriptor.manifest;
      if (manifest && (manifest.apiVersion === 2 || manifest.kind === 'untrusted')) {
        state.kind = manifest.kind ?? 'trusted';
        state.apiVersion = manifest.apiVersion ?? 1;
        state.permissions = manifest.permissions ?? [];
        state.transport = manifest.kind === 'untrusted' ? 'worker' : 'in-process';
      }
      if (error) state.error = error;
      out.push(state);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  getPending(name: string): PluginPendingState | null {
    const pending = this.pending.get(name);
    if (!pending) return null;
    return pending.error === undefined
      ? { revision: pending.revision }
      : { revision: pending.revision, error: pending.error };
  }

  /**
   * Commits the staged candidate of `name`.
   *
   * Only this package's revision moves; the rest of the snapshot is republished
   * unchanged. A failed pending candidate stays pending (its error is returned)
   * so the Hub keeps showing the problem until the files change again.
   */
  applyPending(name: string): Promise<PluginApplyResult> {
    return this.enqueue(() => this.runApplyPending(name));
  }

  /** Full rescan; unchanged packages are carried forward by fingerprint. */
  reload(): Promise<void> {
    return this.enqueue(() => this.runReload());
  }

  /**
   * Marks a package whose next (first) activation must not replace the active
   * runtime: the candidate is validated and staged as pending instead of being
   * committed. Manager install/enable use this so a fresh package cannot
   * silently interrupt running work.
   *
   * The marker is one-shot and only applies when the package is new and owns
   * the runtime currently in use; otherwise the package commits normally.
   */
  stageNewPackage(name: string): void {
    this.stagedNew.add(name);
  }

  /**
   * Activates a candidate from an arbitrary directory, validates every
   * contribution and disposes it again. Nothing is registered on the action/
   * event registries, no loader/bind callback fires and no revision is
   * published — the client snapshot is untouched.
   *
   * This runs trusted local Host code; it is not a security sandbox.
   */
  checkPackage(dir: string): Promise<PluginCheckResult> {
    return this.enqueue(() => this.runCheckPackage(dir));
  }

  /**
   * Disposes and forgets a package (active or pending) so its directory can be
   * deleted. Publishes a new snapshot when the client-visible set changed.
   */
  removePackage(name: string): Promise<PluginRemoveResult> {
    return this.enqueue(() => this.runRemovePackage(name));
  }

  /** Disposes one package's committed/pending revision without touching disk. */
  deactivate(name: string): Promise<boolean> {
    return this.enqueue(() => this.runDeactivate(name));
  }

  /** Disposes every committed/pending package. Used by the kill switch. */
  deactivateAll(): Promise<string[]> {
    return this.enqueue(() => this.runDeactivateAll());
  }

  /**
   * Does this committed package own the runtime name the gateway is using?
   *
   * Read after a commit: a changed runtime package only takes effect once the
   * runtime is rebuilt, so the caller must treat `true` as "switch required".
   * A package that is only pending (not committed yet) answers false.
   */
  packageOwnsActiveRuntime(name: string): boolean {
    const record = this.active.get(name);
    if (!record) return false;
    return this.ownsActiveRuntime(undefined, record);
  }

  /**
   * Recreates every package-directory watcher.
   *
   * On Windows an overwrite install replaces the package directory with a new
   * directory object; a watcher bound to the old handle silently stops firing
   * even though the path is unchanged. The manager calls this after copying a
   * package into the root so hot reload keeps working.
   */
  resetWatchers(): void {
    try {
      for (const watcher of this.dirWatchers.values()) {
        try { watcher.close(); } catch { /* already closed */ }
      }
      this.dirWatchers.clear();
      this.refreshDirWatchers();
    } catch (err) {
      log.warn(`[PluginHost] resetWatchers failed: ${describeError(err)}`);
    }
  }

  stop(): void {
    this.stopped = true;
    this.watcher?.close();
    this.watcher = undefined;
    for (const w of this.dirWatchers.values()) w.close();
    this.dirWatchers.clear();
    if (this.debounce) clearTimeout(this.debounce);
    const bags: RegistrationBag[] = [];
    for (const record of this.active.values()) bags.push(record.bag);
    for (const pending of this.pending.values()) {
      if (pending.activation) bags.push(pending.activation.bag);
    }
    this.active.clear();
    this.pending.clear();
    this.failures.clear();
    this.stagedNew.clear();
    this.lastTools = [];
    this.lastObservers = [];
    this.kernelV2Cb?.([], []);
    void this.disposeBags(bags);
  }

  private currentToken(): string { return `${this.bootId}:${this.counter}`; }

  private nextToken(): string {
    this.counter += 1;
    return this.currentToken();
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(path.join(this.dir, 'README.md'), README_CONTENT);
      log.info(`[PluginHost] Created ${this.dir}`);
    }
  }

  /** 全量重扫：staging 全部 candidate 后再一次性提交。 */
  private async runReload(): Promise<void> {
    if (this.stopped) return;
    // One-shot: a marker staged before this scan never leaks into a later one.
    const stagedNew = this.stagedNew;
    this.stagedNew = new Set<string>();
    const nextActive = new Map<string, ActivePackage>();
    const nextPending = new Map<string, PendingPackage>();
    const nextFailures = new Map<string, PackageFailure>();
    const toDispose: RegistrationBag[] = [];
    const toCommit: PackageActivation[] = [];
    const pkgDirs: string[] = [];
    const scanErrors = new Map<string, PackageFailure>();

    for (const desc of this.scanDescriptors(scanErrors)) {
      if (desc.pkgDir) pkgDirs.push(desc.pkgDir);
      const blocked = this.options.activationBlocked?.(desc.name);
      if (blocked) {
        nextFailures.set(desc.name, {
          source: desc.mainFile,
          error: `blocked: ${blocked}`,
        });
        log.info(`[PluginHost] ${desc.name} skipped: ${blocked}`);
        continue;
      }
      const existing = this.active.get(desc.name);

      let fingerprint: string;
      try {
        fingerprint = fingerprintPackage(desc.mainFile, desc.pkgDir ? { rootDir: desc.pkgDir } : {});
      } catch (err) {
        const message = describeError(err);
        nextFailures.set(desc.name, { source: desc.mainFile, error: message });
        if (existing) nextActive.set(desc.name, existing);
        log.warn(`[PluginHost] ${desc.name} fingerprint error: ${message}`);
        continue;
      }

      if (existing && existing.fingerprint === fingerprint) {
        // Unchanged: reuse instance + bag + revision. A pending candidate for the
        // same name is dropped by the final pending sweep (the file reverted).
        nextActive.set(desc.name, existing);
        continue;
      }

      const previousPending = this.pending.get(desc.name);
      if (previousPending && previousPending.fingerprint === fingerprint) {
        // The staged candidate did not change either: keep it without reactivating.
        if (existing) nextActive.set(desc.name, existing);
        nextPending.set(desc.name, previousPending);
        continue;
      }

      const bag = this.createBag();
      try {
        const activation = await this.activate(desc, bag);
        const staged: PackageActivation = { descriptor: desc, fingerprint, bag, ...activation };
        if (previousPending?.activation) toDispose.push(previousPending.activation.bag);
        const stageNewcomer =
          !existing && stagedNew.has(desc.name) && this.ownsActiveRuntime(activation);
        if ((existing && this.ownsActiveRuntime(activation, existing)) || stageNewcomer) {
          // Active-runtime change: keep the old package live until applyPending.
          if (existing) nextActive.set(desc.name, existing);
          nextPending.set(desc.name, {
            descriptor: desc,
            fingerprint,
            revision: this.nextToken(),
            activation: staged,
          });
        } else {
          toCommit.push(staged);
          this.options.onActivationSuccess?.(desc.name);
        }
      } catch (err) {
        toDispose.push(bag);
        const message = describeError(err);
        nextFailures.set(desc.name, { source: desc.mainFile, error: message });
        if (existing) nextActive.set(desc.name, existing);
        if (previousPending?.activation) toDispose.push(previousPending.activation.bag);
        if (existing && this.ownsActiveRuntime(undefined, existing)) {
          nextPending.set(desc.name, {
            descriptor: desc,
            fingerprint,
            revision: this.nextToken(),
            error: message,
          });
        }
        this.options.onActivationFailure?.(desc.name, message);
        log.warn(`[PluginHost] ${desc.name} activate error: ${message}`);
      }
    }

    // Scan failures (bad manifest / missing main) keep the previous activation.
    for (const [name, failure] of scanErrors) {
      // A directory whose manifest became unreadable is keyed by its folder name,
      // which may differ from the manifest name of the running package. Map the
      // failure back onto the active package so the old descriptor stays usable.
      const existing = this.active.get(name) ?? this.activeBySource(failure.source);
      const stateName = existing?.descriptor.name ?? name;
      nextFailures.set(stateName, failure);
      if (existing) nextActive.set(stateName, existing);
    }

    const committing = new Set(toCommit.map((staged) => staged.descriptor.name));
    const removed: ActivePackage[] = [];
    for (const [name, record] of this.active) {
      // A failure keeps its package in nextActive; a blocked package does not.
      if (nextActive.has(name) || committing.has(name)) continue;
      removed.push(record);
    }

    // Pending candidates whose package disappeared (or reverted) go away.
    for (const [name, pending] of this.pending) {
      if (nextPending.has(name)) continue;
      if (pending.activation) toDispose.push(pending.activation.bag);
    }

    const snapshotChanged = toCommit.length > 0 || removed.length > 0;
    let revision = this.snapshot.revision;
    if (snapshotChanged) {
      revision = this.nextToken();
      for (const staged of toCommit) {
        nextActive.set(staged.descriptor.name, { ...staged, revision });
        const replaced = this.active.get(staged.descriptor.name);
        if (replaced) toDispose.push(replaced.bag);
      }
      for (const record of removed) toDispose.push(record.bag);
    }

    // Commit: release replaced packages first, then publish everything at once.
    await this.disposeBags(toDispose);

    this.active = nextActive;
    this.pending = nextPending;
    this.failures = nextFailures;
    this.pkgDirs = pkgDirs;

    if (snapshotChanged) {
      this.snapshot = this.buildSnapshot(revision);
      for (const staged of toCommit) {
        const committed = nextActive.get(staged.descriptor.name);
        if (committed) this.registerDeclarativeContributions(committed);
      }
      this.publishEntries();
      this.snapshotCb?.(this.snapshot);
      this.broadcastPluginsChanged(revision);
    }
    // A commit above already broadcast the new revision; only a state-only scan
    // (pending/error/enabled change) needs its own `plugins.changed`.
    this.notifyStateChanged(!snapshotChanged);
    this.refreshDirWatchers();
  }

  private async runApplyPending(name: string): Promise<PluginApplyResult> {
    const pending = this.pending.get(name);
    if (!pending) {
      this.options.onActivationFailure?.(name, `no pending revision for "${name}"`);
      return { applied: false, error: `no pending revision for "${name}"` };
    }
    if (!pending.activation) {
      const error = pending.error ?? `pending revision for "${name}" is invalid`;
      this.options.onActivationFailure?.(name, error);
      return { applied: false, error };
    }

    const revision = this.nextToken();
    const replaced = this.active.get(name);
    if (replaced) await this.disposeBags([replaced.bag]);

    const nextActive = new Map(this.active);
    nextActive.set(name, { ...pending.activation, revision });
    const nextPending = new Map(this.pending);
    nextPending.delete(name);

    this.active = nextActive;
    this.pending = nextPending;
    this.snapshot = this.buildSnapshot(revision);
    const applied = nextActive.get(name);
    if (applied) this.registerDeclarativeContributions(applied);
    this.options.onActivationSuccess?.(name);
    this.publishEntries();
    this.snapshotCb?.(this.snapshot);
    this.broadcastPluginsChanged(revision);
    // The commit above already broadcast `plugins.changed`; a state-only
    // broadcast here would be a duplicate. Whether the live runtime still has
    // to be rebuilt is decided against the freshly committed record.
    this.notifyStateChanged(false);
    const runtimeSwitchRequired = this.packageOwnsActiveRuntime(name);
    // The runtime contribution's declared name is the loader key, which is not
    // necessarily the package name: report it so the caller switches the right
    // entry instead of guessing.
    const runtimeName = runtimeSwitchRequired ? applied?.entries.runtime?.name : undefined;
    return {
      applied: true,
      revision,
      runtimeSwitchRequired,
      ...(runtimeName ? { runtimeName } : {}),
    };
  }

  /**
   * Offline candidate check: one private bag, one activation, immediate
   * disposal. Uses the same `activate()` path as a real commit, so manifest,
   * module shape, contribution validation and runtime factory wiring are all
   * exercised — but nothing is registered or published.
   */
  private async runCheckPackage(dir: string): Promise<PluginCheckResult> {
    const pkgDir = path.resolve(dir);
    let manifest: PackageManifest | undefined;
    let name = path.basename(pkgDir).replace(/\.js$/i, '');
    let mainFile = pkgDir;
    let packageDir: string | undefined;
    let declared: PluginCheckDeclared | undefined;
    let warnings: string[] = [];
    // Where the check currently is: the only stage signal failure
    // classification trusts (see `classifyCheckFailure`). Nothing has been
    // observed yet, so a path that does not resolve is `candidate_missing`
    // rather than a manifest or activation problem.
    let stage: PluginCheckStage = 'candidate';
    // Filled by the activation below; a candidate that never loads reports an
    // empty inventory instead of omitting the field.
    const inventory: PluginCheckInventory = {
      registered: { actions: [], events: [], tools: [], observers: [], http: 0 },
      evaluated: false,
    };
    try {
      // A missing path throws ENOENT here; a socket or device is neither shape
      // we can check. Both mean "there was no candidate", not "bad package".
      const stat = fs.statSync(pkgDir);
      if (!stat.isDirectory() && !stat.isFile()) {
        throw new Error('candidate is not a file or directory');
      }
      stage = 'manifest';
      if (stat.isDirectory()) {
        const manifestPath = path.join(pkgDir, 'plugin.json');
        if (!fs.existsSync(manifestPath)) throw new Error('plugin.json not found');
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        if (typeof manifest?.name !== 'string' || manifest.name.length === 0) {
          throw new Error('plugin.json is missing "name"');
        }
        name = manifest.name;
        // Normalize before touching the entry. The normalizer judges the
        // manifest itself (`"main": 123`, unsupported apiVersion), and letting
        // the entry stage run first would turn those into a Node type error or
        // a bogus `entry_missing`. It also guarantees `declared`/`warnings`
        // quote exactly the bound activation enforces, including on a failure
        // that happens later.
        const parsedManifest = parsePackageManifest(manifest);
        declared = describeDeclared(parsedManifest.manifest?.contributes?.gateway);
        warnings = parsedManifest.warnings ?? [];
        if (!parsedManifest.ok) throw new Error(parsedManifest.errors.join('; '));
        stage = 'entry';
        mainFile = path.join(pkgDir, manifest.main ?? 'index.js');
        // A `main` that exists but is a directory or an unreadable file passes
        // this check and surfaces as `activation_failed` from `require()`.
        if (!fs.existsSync(mainFile)) throw new Error(`main file not found: ${manifest.main ?? 'index.js'}`);
        packageDir = pkgDir;
      }
      const desc: PackageDescriptor = {
        name,
        mainFile,
        ...(manifest !== undefined ? { manifest } : {}),
        ...(packageDir !== undefined ? { pkgDir: packageDir } : {}),
      };
      const bag = this.createBag();
      stage = 'activation';
      try {
        const activation = await this.activate(desc, bag, true, inventory);
        // The success result is `evaluated: true` by construction: `activate()`
        // returned, so both activation paths captured a contribution set.
        // Web surfaces are the only slot with on-disk assets; activation already
        // validated them, so the summary is authoritative for the install preview.
        const webSurfaces = activation.activated.ui.webSurfaces ?? [];
        const result: PluginCheckResult = {
          ok: true,
          name,
          version: activation.version ?? manifest?.version,
          contributions: activation.contributions,
          ...(manifest?.apiVersion !== undefined ? { apiVersion: manifest.apiVersion } : {}),
          ...(manifest?.kind !== undefined ? { kind: manifest.kind } : {}),
          ...(manifest?.permissions !== undefined ? { permissions: manifest.permissions } : {}),
          ...(declared !== undefined ? { declared } : {}),
          registered: inventory.registered,
          evaluated: true,
          ...(warnings.length > 0 ? { warnings } : {}),
        };
        if (webSurfaces.length > 0) {
          result.webSurfaces = {
            count: webSurfaces.length,
            rail: webSurfaces.some((surface) => surface.rail !== undefined),
          };
        }
        return result;
      } finally {
        await this.disposeBags([bag]);
        // The candidate was not committed: drop its modules so a later install
        // (or edit) re-evaluates the files instead of the checked snapshot.
        this.invalidatePackageCache(desc);
      }
    } catch (err) {
      return {
        ok: false,
        name,
        version: manifest?.version,
        error: describeError(err),
        code: classifyCheckFailure(stage, err),
        evaluated: inventory.evaluated,
        ...(declared !== undefined ? { declared } : {}),
        registered: inventory.registered,
        ...(warnings.length > 0 ? { warnings } : {}),
      };
    }
  }

  /** Dispose + forget one package so the manager can delete its directory. */
  private async runRemovePackage(name: string): Promise<PluginRemoveResult> {
    const active = this.active.get(name);
    const pending = this.pending.get(name);
    // Close the package-directory watcher first: on Windows an open directory
    // handle can block deletion, and a burst from the same watcher must not
    // re-activate the package while its files are being removed.
    const pkgDir = active?.descriptor.pkgDir ?? pending?.descriptor.pkgDir;
    if (pkgDir) {
      this.dirWatchers.get(pkgDir)?.close();
      this.dirWatchers.delete(pkgDir);
      this.pkgDirs = this.pkgDirs.filter((dir) => dir !== pkgDir);
    }
    const bags: RegistrationBag[] = [];
    if (active) bags.push(active.bag);
    if (pending?.activation) bags.push(pending.activation.bag);
    await this.disposeBags(bags);

    const nextPending = new Map(this.pending);
    nextPending.delete(name);
    const nextFailures = new Map(this.failures);
    nextFailures.delete(name);
    this.pending = nextPending;
    this.failures = nextFailures;

    if (!active) {
      // Pending candidates and failures are not client-visible: no snapshot
      // change and no revision bump. They are, however, Hub-visible: broadcast a
      // state-only `plugins.changed` so the client re-pulls package state.
      this.notifyStateChanged(true);
      return { removed: false };
    }

    const nextActive = new Map(this.active);
    nextActive.delete(name);
    const revision = this.nextToken();
    this.active = nextActive;
    this.snapshot = this.buildSnapshot(revision);
    this.publishEntries();
    this.snapshotCb?.(this.snapshot);
    this.broadcastPluginsChanged(revision);
    // The commit broadcast covers this change.
    this.notifyStateChanged(false);
    return { removed: true, revision };
  }

  private async runDeactivate(name: string): Promise<boolean> {
    const active = this.active.get(name);
    const pending = this.pending.get(name);
    if (!active && !pending) return false;

    const bags: RegistrationBag[] = [];
    if (active) bags.push(active.bag);
    if (pending?.activation) bags.push(pending.activation.bag);
    await this.disposeBags(bags);

    const nextPending = new Map(this.pending);
    nextPending.delete(name);
    this.pending = nextPending;

    if (!active) {
      this.notifyStateChanged(true);
      return true;
    }

    const nextActive = new Map(this.active);
    nextActive.delete(name);
    const revision = this.nextToken();
    this.active = nextActive;
    this.snapshot = this.buildSnapshot(revision);
    this.publishEntries();
    this.snapshotCb?.(this.snapshot);
    this.broadcastPluginsChanged(revision);
    this.notifyStateChanged(false);
    return true;
  }

  private async runDeactivateAll(): Promise<string[]> {
    const names = [...new Set([...this.active.keys(), ...this.pending.keys()])].sort();
    if (names.length === 0) return [];
    const bags: RegistrationBag[] = [];
    for (const name of names) {
      const active = this.active.get(name);
      const pending = this.pending.get(name);
      if (active) bags.push(active.bag);
      if (pending?.activation) bags.push(pending.activation.bag);
    }
    await this.disposeBags(bags);

    const revision = this.nextToken();
    this.active = new Map();
    this.pending = new Map();
    this.snapshot = this.buildSnapshot(revision);
    this.publishEntries();
    this.snapshotCb?.(this.snapshot);
    this.broadcastPluginsChanged(revision);
    this.notifyStateChanged(false);
    return names;
  }

  /**
   * Attaches a committed package's actions/events to its bag.
   *
   * Only called from the commit path: a staged candidate's registrations must
   * not be reachable before the loader/snapshot switch. Registration cleanup is
   * owned by the same bag, so a delete/replace aborts in-flight actions and
   * makes late emits no-ops.
   */
  private registerDeclarativeContributions(record: ActivePackage): void {
    const name = record.descriptor.name;
    // Registration diagnostics are already emitted through the registries'
    // `onDiagnostic` hook (host logging); the return values stay available for
    // callers that inspect them (tests/future Hub diagnostics).
    this.actions.register(name, record.activated.actions, record.bag, undefined, {
      revision: record.revision,
    });
    this.events.register(name, record.activated.events, record.bag, {
      revision: record.revision,
      token: record.emitterToken,
    });
    // Host services (`ctx.terminal`): the PTY handle is owned by the activation's
    // own bag (see `createPluginTerminalApi`), which is disposed with this
    // record. There is deliberately no package-wide sweep here: during a
    // re-activating reload the successor candidate activates *before* the
    // replaced revision's bag is disposed, so sweeping by package name would
    // close the new revision's PTYs.
    // HTTP/WS routes are replayed from the activation recorder only here: a
    // staged candidate stays unreachable until its revision is committed. The
    // retirement disposer is attached to the same bag at commit time (never at
    // activation time), so discarding a *pending* candidate cannot retire the
    // still-active revision's routes. It is added before the registrations so a
    // mid-loop failure cannot leave routes without an owner.
    if (record.http.entries.length > 0) {
      record.bag.add('http-routes', () => this.http.retire(name));
    }
    for (const route of record.http.entries) {
      if (route.kind === 'http') {
        this.http.register(name, route.method, route.path, route.handler, {
          maxBodyBytes: route.maxBodyBytes,
        });
      } else {
        this.http.registerWs(name, route.path, route.handler);
      }
    }
  }

  /**
   * Publishes the gateway flat `plugins.changed` event once per committed
   * snapshot. Activation staging, failed candidates and unchanged rescans do
   * not reach this point, so clients only re-pull on a real revision change.
   */
  private broadcastPluginsChanged(revision: string): void {
    if (!this.broadcast) return;
    try {
      this.broadcast({ type: 'plugins.changed', properties: { revision } });
    } catch (err) {
      log.warn(`[PluginHost] plugins.changed broadcast failed: ${describeError(err)}`);
    }
  }

  private buildSnapshot(revision: string): PluginClientSnapshot {
    const plugins = [...this.active.values()]
      .sort((a, b) => a.descriptor.name.localeCompare(b.descriptor.name))
      .map((record) => buildClientDescriptor({
        name: record.descriptor.name,
        version: record.version ?? record.descriptor.manifest?.version,
        revision: record.revision,
        activated: record.activated,
      }));
    return buildClientSnapshot(revision, plugins);
  }

  private publishEntries(): void {
    const runtime: RuntimePackageEntry[] = [];
    const media: MediaPackageEntry[] = [];
    const tts: TtsPackageEntry[] = [];
    const usage: UsagePackageEntry[] = [];
    const tools: PluginToolEntry[] = [];
    const observers: PluginObserverEntry[] = [];
    const records = [...this.active.values()].sort((a, b) => a.descriptor.name.localeCompare(b.descriptor.name));
    for (const record of records) {
      const entries = record.entries;
      if (entries.runtime) runtime.push(entries.runtime);
      if (entries.media) media.push(entries.media);
      if (entries.tts) tts.push(entries.tts);
      if (entries.usage) usage.push(entries.usage);
      for (const declaration of record.activated.tools) {
        tools.push({
          ...declaration,
          packageName: record.descriptor.name,
          revision: record.revision,
        });
      }
      for (const declaration of record.activated.observers) {
        observers.push({
          ...declaration,
          packageName: record.descriptor.name,
          revision: record.revision,
        });
      }
    }
    this.lastRuntime = runtime;
    this.lastMedia = media;
    this.lastTts = tts;
    this.lastUsage = usage;
    this.lastTools = tools;
    this.lastObservers = observers;
    this.runtimeCb?.(runtime);
    this.mediaCb?.(media);
    this.ttsCb?.(tts);
    this.usageCb?.(usage);
    this.kernelV2Cb?.(tools, observers);
  }

  private notifyStateChanged(broadcastChange = true): void {
    const signature = JSON.stringify(this.getState());
    if (signature === this.lastStateSignature) return;
    this.lastStateSignature = signature;
    this.stateCb?.();
    // Pending candidates, failures and enabled/disabled changes are visible in
    // the Hub but do not move the active revision. Clients still need a signal:
    // broadcast the unchanged revision with `stateChanged` so Desktop re-pulls
    // `/api/plugins` without weakening the stale-revision guard on commits.
    if (broadcastChange) this.broadcastStateChanged();
  }

  private broadcastStateChanged(): void {
    if (!this.broadcast) return;
    try {
      this.broadcast({
        type: 'plugins.changed',
        properties: { revision: this.snapshot.revision, stateChanged: true },
      });
    } catch (err) {
      log.warn(`[PluginHost] plugins.changed state broadcast failed: ${describeError(err)}`);
    }
  }

  private async disposeBags(bags: RegistrationBag[]): Promise<void> {
    for (const bag of bags) {
      const diagnostics = await bag.dispose();
      for (const diagnostic of diagnostics) {
        log.warn(`[PluginHost] dispose "${diagnostic.name}" failed: ${diagnostic.message}`);
      }
    }
  }

  private activeRuntimeName(): string | null {
    try {
      const name = this.options.activeRuntime?.();
      return typeof name === 'string' && name.length > 0 ? name : null;
    } catch {
      return null;
    }
  }

  /** Does this change touch the runtime the gateway is currently using? */
  private ownsActiveRuntime(
    activation: ActivationResult | undefined,
    existing?: ActivePackage,
  ): boolean {
    const active = this.activeRuntimeName();
    if (!active) return false;
    const candidate = activation?.entries.runtime?.name;
    const current = existing?.entries.runtime?.name;
    return candidate === active || current === active;
  }

  /** Finds an active package by its on-disk root (used when a scan fails). */
  private activeBySource(source: string): ActivePackage | undefined {
    const normalize = (value: string): string => {
      const resolved = path.resolve(value);
      return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    };
    const wanted = normalize(source);
    for (const record of this.active.values()) {
      const root = record.descriptor.pkgDir ?? record.descriptor.mainFile;
      if (normalize(root) === wanted) return record;
    }
    return undefined;
  }

  /** 每个目录包一个 watcher（跨平台——不用 recursive）。reload 后按当前包集合增删。 */
  private refreshDirWatchers(): void {
    if (this.stopped || !this.watcher) return; // 顶层 watch 未建立（init 前手动 reload）则不建
    const wanted = new Set(this.pkgDirs);
    for (const [dir, w] of this.dirWatchers) {
      if (!wanted.has(dir)) { w.close(); this.dirWatchers.delete(dir); }
    }
    for (const dir of wanted) {
      if (this.dirWatchers.has(dir)) continue;
      try {
        const w = fs.watch(dir, () => {
          if (this.debounce) clearTimeout(this.debounce);
          this.debounce = setTimeout(() => {
            void this.reload().catch((err) => log.warn(`[PluginHost] reload error: ${err.message}`));
          }, 300);
        });
        this.dirWatchers.set(dir, w);
      } catch { /* 单个目录不可 watch → 跳过，fail-open */ }
    }
  }

  /** Manager-owned enabled/disabled thunk; never throws on a broken store. */
  private isDisabledPackage(name: string): boolean {
    try {
      return this.options.isDisabled?.(name) === true;
    } catch (err) {
      log.warn(`[PluginHost] disabled-state lookup failed for ${name}: ${describeError(err)}`);
      return false;
    }
  }

  /** 枚举候选包；逐条错误记入 errorStates（不抛出）。 */
  private scanDescriptors(errorStates: Map<string, PackageFailure>): PackageDescriptor[] {
    const out: PackageDescriptor[] = [];
    if (!fs.existsSync(this.dir)) return out;
    const entries = fs.readdirSync(this.dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      // Dot entries are manager scratch space (install/backup temp dirs) and OS
      // metadata, never packages. Disabled packages stay on disk but are
      // skipped so their contributions disappear from loaders and the snapshot.
      if (entry.name.startsWith('.')) continue;
      try {
        if (entry.isFile() && entry.name.endsWith('.js')) {
          const name = entry.name.replace(/\.js$/, '');
          if (this.isDisabledPackage(name)) continue;
          out.push({ name, mainFile: path.join(this.dir, entry.name) });
        } else if (entry.isDirectory()) {
          const pkgDir = path.join(this.dir, entry.name);
          // Check the folder name first: a disabled package with an unreadable
          // manifest must stay silent instead of surfacing as an error entry.
          if (this.isDisabledPackage(entry.name)) continue;
          const manifestPath = path.join(pkgDir, 'plugin.json');
          let manifest: PackageManifest | undefined;
          if (fs.existsSync(manifestPath)) {
            manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
          }
          const name = manifest?.name ?? entry.name;
          if (this.isDisabledPackage(name)) continue;
          const mainFile = path.join(pkgDir, manifest?.main ?? 'index.js');
          if (!fs.existsSync(mainFile)) throw new Error(`main file not found: ${manifest?.main ?? 'index.js'}`);
          out.push({ name, mainFile, manifest, pkgDir });
        }
      } catch (err: any) {
        errorStates.set(entry.name, { source: path.join(this.dir, entry.name), error: err.message });
      }
    }
    return out;
  }

  private async activateWorker(
    desc: PackageDescriptor,
    bag: RegistrationBag,
    probe = false,
    inventory?: PluginCheckInventory,
  ): Promise<ActivationResult> {
    const parsed = desc.manifest ? parsePackageManifest(desc.manifest) : null;
    if (!parsed?.ok || !parsed.manifest || parsed.manifest.kind !== 'untrusted') {
      throw new Error('untrusted package manifest is invalid');
    }
    if (!this.options.workerHostFactory) {
      throw new Error('worker_unavailable: no worker host factory');
    }
    const available = this.options.workerAvailable?.() ?? false;
    if (!available) throw new Error('worker_unavailable: untrusted packages are not enabled');

    const installed = this.options.installedFingerprint?.(desc.name);
    if (!probe && installed) {
      const current = fingerprintPackage(
        desc.mainFile,
        desc.pkgDir ? { rootDir: desc.pkgDir } : {},
      );
      if (current !== installed) {
        this.options.onUntrustedDrift?.(desc.name, 'fingerprint changed on disk');
        throw new Error('untrusted package changed on disk; reinstall or unquarantine explicitly');
      }
    }

    const emitterToken = {};
    const worker = this.options.workerHostFactory(desc, parsed.manifest, {
      emit: (event) => this.events.emitFrom(desc.name, emitterToken, event),
    });

    try {
      const ready = await worker.start();
      const raw = ready.contributions ?? {};
      // The worker delivered its contribution set: from here on the check has
      // observed what the package registers, even if the host rejects it.
      // Untrusted packages cannot own HTTP routes (the worker protocol does not
      // expose `ctx.http`), so the recorded count stays 0.
      if (inventory) {
        inventory.registered = registeredFromRaw(raw, 0);
        inventory.evaluated = true;
      }
      const unsupported = Object.keys(raw).filter(
        (key) => raw[key] !== undefined && key !== 'actions' && key !== 'events',
      );
      if (unsupported.length > 0) {
        throw new Error(`not allowed in untrusted worker: ${unsupported.join(', ')}`);
      }
      if (raw.actions && Object.keys(raw.actions as object).length > 0
        && !parsed.manifest.permissions.includes('actions')) {
        throw new Error('permission denied: actions');
      }
      if (raw.events && Object.keys(raw.events as object).length > 0
        && !parsed.manifest.permissions.includes('events')) {
        throw new Error('permission denied: events');
      }

      const actions: Record<string, PluginActionDeclaration> = {};
      const rawActions = raw.actions && typeof raw.actions === 'object'
        ? raw.actions as Record<string, Record<string, unknown>>
        : {};
      for (const [name, declaration] of Object.entries(rawActions)) {
        actions[name] = {
          ...(declaration as unknown as PluginActionDeclaration),
          handler: (input) => worker.invoke(
            name,
            input,
            typeof declaration.timeoutMs === 'number' ? declaration.timeoutMs : undefined,
          ),
        };
      }

      const built = buildActivatedContributions(
        desc.name,
        {
          actions,
          events: Object.values(raw.events ?? {}) as UnifiedPluginContributions['events'],
        },
        this.canonicalTypes,
        parsed.manifest.contributes,
      );
      if (!built.ok) throw new Error(`invalid contributions: ${built.errors.join('; ')}`);

      const httpRecorder = createPluginHttpRecorder(desc.name);
      httpRecorder.seal();
      bag.effect(() => worker.stop('dispose'));

      const kinds: string[] = [];
      if (Object.keys(actions).length > 0) kinds.push('actions');
      if (Object.keys(raw.events ?? {}).length > 0) kinds.push('events');
      return {
        ...(ready.version !== undefined ? { version: ready.version } : {}),
        contributions: kinds,
        activated: built.value,
        entries: {},
        emitterToken,
        http: httpRecorder,
      };
    } catch (err) {
      await worker.stop('activate-failed').catch(() => {});
      throw err;
    }
  }

  private async activate(
    desc: PackageDescriptor,
    bag: RegistrationBag,
    probe = false,
    inventory?: PluginCheckInventory,
  ): Promise<ActivationResult> {
    // One activate() result = one bag = one revision. Action/event registries
    // attach their cleanups to this bag at commit time
    // (registerDeclarativeContributions), so the per-package lifecycle has
    // exactly one owner from the first scan onwards.
    void bag;
    this.invalidatePackageCache(desc);
    const parsedManifest = desc.manifest ? parsePackageManifest(desc.manifest) : null;
    if (parsedManifest && !parsedManifest.ok) {
      throw new Error(parsedManifest.errors.join('; '));
    }
    const hostVersion = this.options.hostVersion
      ?? process.env.MAFW_HOST_VERSION
      ?? '5.1.0';
    if (parsedManifest?.manifest?.host
      && !isHostRangeCompatible(parsedManifest.manifest.host, hostVersion)) {
      throw new Error(
        `host range ${parsedManifest.manifest.host} does not include ${hostVersion}`,
      );
    }
    if (desc.manifest?.kind === 'untrusted') {
      return this.activateWorker(desc, bag, probe, inventory);
    }
    const mod = require(desc.mainFile);
    const modName = mod?.name;
    if (typeof modName !== 'string' || !modName) throw new Error('missing name');
    if (modName !== desc.name) throw new Error(`name mismatch: exports '${modName}', package '${desc.name}'`);
    // `ctx.emit` is package-scoped: it can only publish events this package
    // registered (the emitter token ties the closure to this activation).
    const emitterToken = {};
    // `ctx.http` records routes for this candidate only. Registrations are
    // replayed into the committed registry at commit time; an offline check
    // discards them with the candidate.
    const httpRecorder = createPluginHttpRecorder(modName);
    const ctx = withPluginHttp(
      withPluginEmit(this.createContext(modName, bag), (event) => {
        this.events.emitFrom(modName, emitterToken, event);
      }),
      httpRecorder.api,
    );
    let raw: UnifiedPluginContributions;
    try {
      raw = typeof mod.activate === 'function' ? ((await mod.activate(ctx)) ?? {}) : pickContributions(mod);
    } finally {
      // A registration outside activate() could never be committed; seal so a
      // late timer/async callback fails loudly instead of disappearing.
      httpRecorder.seal();
    }

    // Record what the candidate tried to register before validation can drop
    // it: a rejected registration is the half of the diff an author needs. This
    // is also the moment the check becomes `evaluated`: the package produced a
    // contribution set, so every later failure is a declared-plane verdict, not
    // a "never ran" one.
    if (inventory) {
      inventory.registered = registeredFromRaw(raw, httpRecorder.entries.length);
      inventory.evaluated = true;
    }

    // `contributes.gateway.http` is a static opt-out of the http plane; routes
    // are only observable after activate() returns, so the bound is checked once
    // the recorder is sealed.
    if (parsedManifest?.manifest?.contributes?.gateway?.http === false
      && httpRecorder.entries.length > 0) {
      throw new Error('http routes are not declared (contributes.gateway.http is false)');
    }

    // Declarative half is validated before anything is published; legacy
    // contributions are the same object with `ui`/`actions`/`events` removed.
    const built = buildActivatedContributions(
      modName,
      raw,
      this.canonicalTypes,
      parsedManifest?.manifest?.contributes,
    );
    if (!built.ok) throw new Error(`invalid contributions: ${built.errors.join('; ')}`);
    const activated = built.value;
    // The risk is *no manifest*, not the file form: without `plugin.json` there
    // is no `contributes`, no declared permissions and no install-time consent.
    // A single `.js` file and a directory without `plugin.json` both satisfy
    // that, so the gate keys on manifest absence. Such a package may keep
    // contributing data planes (ui/actions/events/legacy) but must not widen the
    // agent's tool surface, subscribe to canonical events, or publish HTTP
    // routes.
    if (parsedManifest?.manifest === undefined) {
      const denied: string[] = [];
      if (activated.tools.length > 0) denied.push('tools');
      if (activated.observers.length > 0) denied.push('observers');
      if (httpRecorder.entries.length > 0) denied.push('http');
      if (denied.length > 0) {
        throw new Error(
          `packages without plugin.json cannot contribute ${denied.join(', ')}; `
          + 'ship a directory package with plugin.json',
        );
      }
    }
    // Web surfaces are the one UI slot with on-disk assets: the shared contract
    // only validates the declaration, so the real files are checked here. A
    // declared entry that does not resolve fails the whole package instead of
    // publishing a surface that would 404 when opened.
    const webSurfaces = activated.ui.webSurfaces ?? [];
    if (webSurfaces.length > 0) {
      const webErrors = desc.pkgDir
        ? validatePluginWebSurfaces(desc.pkgDir, webSurfaces)
        : webSurfaces.map((surface) => {
            const entry = surface.entry ?? DEFAULT_WEB_SURFACE_ENTRY;
            return (
              `web surface "${surface.id}" entry "${entry}" is not supported in a single-file ` +
              'package (no package web/ directory)'
            );
          });
      if (webErrors.length > 0) throw new Error(`invalid web surfaces: ${webErrors.join('; ')}`);
    }
    const contribs: PluginContributions = activated.legacy;

    const kinds: string[] = [];
    let runtime: RuntimePackageEntry | undefined;
    let media: MediaPackageEntry | undefined;
    let tts: TtsPackageEntry | undefined;
    let usage: UsagePackageEntry | undefined;

    if (contribs.usage) {
      const u = contribs.usage;
      if (typeof u.name !== 'string' || !u.name) throw new Error('usage contribution missing name');
      if (typeof u.fetch !== 'function') throw new Error('usage contribution missing fetch(ctx)');
      usage = { mod: u, source: desc.mainFile };
      kinds.push('usage');
    }
    if (contribs.media) {
      const spec = contribs.media;
      if (!Array.isArray(spec.modalities) || spec.modalities.length === 0
          || !spec.modalities.every((m) => VALID_MODALITIES.has(m))) throw new Error('media: invalid modalities');
      const hasCreatePrompt = typeof spec.createPrompt === 'function';
      const hasPiEngine = spec.engine === 'pi';
      if (hasCreatePrompt === hasPiEngine) throw new Error('media: createPrompt and engine:"pi" are mutually exclusive');
      const prompt = hasCreatePrompt
        ? await spec.createPrompt!(ctx)
        : createPiPromptAdapter({ fixPayload: spec.fixPayload, getApiKey: (p) => ctx.apiKey(p) });
      if (typeof prompt !== 'function') throw new Error('media: createPrompt did not return a function');
      media = { name: spec.name ?? modName, prompt, modalities: spec.modalities, source: desc.mainFile };
      kinds.push('media');
    }
    if (contribs.tts) {
      const spec = contribs.tts;
      if (typeof spec.synthesize !== 'function') throw new Error('tts: missing synthesize(ctx, text, opts)');
      if (typeof spec.voices !== 'function') throw new Error('tts: missing voices()');
      if (!spec.capabilities || typeof spec.capabilities.sampleRate !== 'number') throw new Error('tts: capabilities.sampleRate required');
      const engine: TtsEngine = {
        name: spec.name ?? modName,
        // 包贡献面的键名是 `capabilities`（插件公开面），引擎内部叫 `profile`。
        profile: spec.capabilities,
        voices: () => spec.voices(),
        synthesize: (text: string, opts: TtsOpts) => spec.synthesize(ctx, text, opts),
        synthesizeStream: spec.synthesizeStream
          ? (text: string, opts: TtsOpts, signal: AbortSignal) => spec.synthesizeStream!(ctx, text, opts, signal)
          : async function* (): AsyncIterable<PcmChunk> { throw new Error('tts engine does not support native streaming'); },
      };
      tts = { name: engine.name, engine, source: desc.mainFile };
      kinds.push('tts');
    }
    if (contribs.runtime) {
      const spec = contribs.runtime;
      if (typeof spec.createRuntime !== 'function') throw new Error('runtime: missing createRuntime(ctx)');
      runtime = {
        name: spec.name ?? modName,
        // 包 runtime 一律拿统一 ctx（忽略 loader 传入的 legacy ctx）
        createRuntime: (_ignored: any) => spec.createRuntime(ctx),
        capabilities: spec.capabilities ?? {},
        external: spec.external !== false,
        source: desc.mainFile,
      };
      kinds.push('runtime');
    }
    if (contribs.uiTools) {
      // 声明期字段级校验：桌面 validateCard 是运行时兜底，形状错位应在激活期暴露
      if (typeof contribs.uiTools !== 'object' || Array.isArray(contribs.uiTools)) {
        throw new Error(`uiTools must be an object (got ${typeof contribs.uiTools})`);
      }
      for (const [tool, def] of Object.entries(contribs.uiTools)) {
        if (!def || typeof def !== 'object' || Array.isArray(def)) {
          throw new Error(`uiTools.${tool} must be an object (got ${Array.isArray(def) ? 'array' : typeof def})`);
        }
      }
      kinds.push('uiTools');
    }

    if (activated.actions.length > 0) kinds.push('actions');
    if (activated.events.length > 0) kinds.push('events');
    if (activated.tools.length > 0) kinds.push('tools');
    if (activated.observers.length > 0) kinds.push('observers');
    if (hasUiSlots(activated.ui)) kinds.push('ui');

    if (kinds.length === 0) {
      throw new Error(
        'no contributions (usage/media/runtime/tts/uiTools/ui/actions/events/tools/observers)',
      );
    }

    return {
      version: desc.manifest?.version,
      contributions: kinds,
      activated,
      entries: { runtime, media, tts, usage },
      emitterToken,
      http: httpRecorder,
    };
  }

  /**
   * Drops the cached modules of this package's local subtree only.
   *
   * A single-file package is exactly one module; a directory package covers
   * every module below its root (nested `lib/`, bundled deps) while sibling
   * packages and gateway modules stay cached.
   */
  private invalidatePackageCache(desc: PackageDescriptor): void {
    const main = path.resolve(desc.mainFile);
    const root = desc.pkgDir ? path.resolve(desc.pkgDir) : null;
    const normalize = (value: string): string => (process.platform === 'win32' ? value.toLowerCase() : value);
    const normalizedMain = normalize(main);
    const normalizedRoot = root ? normalize(root) : null;
    for (const key of Object.keys(require.cache)) {
      const resolved = normalize(path.resolve(key));
      if (resolved === normalizedMain) {
        delete require.cache[key];
        continue;
      }
      if (!normalizedRoot) continue;
      const relative = path.relative(normalizedRoot, resolved);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue;
      delete require.cache[key];
    }
  }

  private startWatch(): void {
    if (!fs.existsSync(this.dir)) return;
    try {
      this.watcher = fs.watch(this.dir, () => {
        if (this.debounce) clearTimeout(this.debounce);
        this.debounce = setTimeout(() => {
          if (!fs.existsSync(this.dir)) { this.watcher?.close(); this.watcher = undefined; return; }
          void this.reload().catch((err) => log.warn(`[PluginHost] reload error: ${err.message}`));
        }, 300);
      });
      // init 的 reload 跑在本方法之前（当时 watcher 未建，refreshDirWatchers 早退）
      // ——这里补建目录包子目录的 watcher。
      this.refreshDirWatchers();
    } catch (err: any) {
      log.warn(`[PluginHost] watch failed: ${err.message}`);
    }
  }
}

function pickContributions(mod: any): PluginContributions {
  const out: PluginContributions = {};
  if (mod.usage) out.usage = mod.usage;
  if (mod.media) out.media = mod.media;
  if (mod.runtime) out.runtime = mod.runtime;
  if (mod.tts) out.tts = mod.tts;
  if (mod.uiTools) out.uiTools = mod.uiTools;
  return out;
}

const README_CONTENT = `# MAFW Plugin Packages

一个插件包可以同时贡献多种能力（usage 配额 / media 引擎 / runtime / UI 工具卡）。
包内容变化按内容指纹热重载：未变的包不会重新激活。

## 形态

- 单文件包：\`my-vendor.js\`（包名 = 文件名）
- 目录包：\`my-vendor/plugin.json\`（\`{ "name", "version"?, "main"? }\`，main 缺省 index.js）
- \`tools\` / \`observers\` / \`http\` 三个面需要带 \`plugin.json\` 的目录包；单文件包与缺 \`plugin.json\` 的目录包只能用 ui / actions / events / legacy。详见 \`docs/guides/plugin-authoring.md\`。

## 模块形状（二选一）

\`\`\`js
module.exports = {
  name: "my-vendor",
  usage:   { name: "my-vendor", type: "api", plan: "P", async fetch(ctx) {} },
  media:   { modalities: ["image"], engine: "pi", fixPayload(p) {} },
  runtime: { capabilities: {}, async createRuntime(ctx) {} },
  uiTools: {},  // v1 仅在插件中心展示登记，桌面侧加载仍走 ~/.mafw/ui-plugins/
};
// 或：module.exports = { name, async activate(ctx) { return { usage: {...} }; } };
\`\`\`

## ctx（三个 legacy ctx 的超集）

- \`ctx.apiKey(provider)\` / \`ctx.fetch(url, opts)\`（60s）/ \`ctx.log\`
- \`ctx.effect(dispose)\` —— 注册 timer/listener 等清理；包被替换/停用/删除或离线 check 结束时执行（LIFO）
- \`ctx.pluginConfig()\` —— 读 config.yaml \`plugins.<name>.config\`（回退 legacy 三段 pluginConfig）
- \`ctx.projectDir\` / \`ctx.gatewayPort\` / \`ctx.usage.modelStats({sinceMs?, provider?})\`
- \`ctx.files.list(projectDir, rel)\` / \`stat\` / \`read(projectDir, rel, {maxBytes?})\` —— 只读项目文件；
  projectDir 传请求票据绑定的目录（不是 ctx.projectDir），越界/点文件/符号链接逃逸一律拒绝
- \`ctx.terminal.create({projectDir, cols?, rows?})\` / \`bridge(id, ws)\` / \`resize\` / \`kill\` ——
  与桌面终端同一 PTY；包被替换/停用/删除时自动关闭本包创建的会话

## 优先级

同名时：**包 > legacy 目录文件（usage-plugins/ media-plugins/ runtime-plugins/）> 内置**。
legacy 目录行为不变。reload 清变更包的本地模块子树；改动会按内容指纹自动热重载。
`;
