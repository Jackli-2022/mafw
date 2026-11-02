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
import { createRegistrationBag, type RegistrationBag } from './registration-bag';
import type {
  ActivatedContributions,
  MediaPackageEntry,
  PackageDescriptor,
  PackageManifest,
  PackageState,
  PluginContributions,
  PluginPackageContext,
  RuntimePackageEntry,
  TtsPackageEntry,
  UnifiedPluginContributions,
  UsagePackageEntry,
} from './package-types';
import type { PcmChunk, TtsEngine, TtsOpts } from '../tts/types';

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

function hasUiSlots(ui: ActivatedContributions['ui']): boolean {
  return Object.values(ui).some((slot) => Array.isArray(slot) && slot.length > 0);
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
  private snapshotCb?: (snapshot: PluginClientSnapshot) => void;
  private stateCb?: () => void;
  private lastRuntime: RuntimePackageEntry[] = [];
  private lastMedia: MediaPackageEntry[] = [];
  private lastTts: TtsPackageEntry[] = [];
  private lastUsage: UsagePackageEntry[] = [];
  private readonly createBag: () => RegistrationBag;
  private readonly canonicalTypes: ReadonlySet<string>;

  constructor(
    private dir: string,
    private createContext: (name: string) => PluginPackageContext,
    private options: PluginHostOptions = {},
  ) {
    this.bootId = options.bootId ?? randomBytes(8).toString('hex');
    this.canonicalTypes = options.canonicalTypes ?? EMPTY_CANONICAL_TYPES;
    this.createBag = options.createBag ?? createRegistrationBag;
    this.snapshot = buildClientSnapshot(this.currentToken(), []);
    this.lastStateSignature = JSON.stringify(this.getState());
  }

  bindRuntime(cb: (entries: RuntimePackageEntry[]) => void): void { this.runtimeCb = cb; cb(this.lastRuntime); }
  bindMedia(cb: (entries: MediaPackageEntry[]) => void): void { this.mediaCb = cb; cb(this.lastMedia); }
  bindTts(cb: (entries: TtsPackageEntry[]) => void): void { this.ttsCb = cb; cb(this.lastTts); }
  bindUsage(cb: (entries: UsagePackageEntry[]) => void): void { this.usageCb = cb; cb(this.lastUsage); }

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
    const nextActive = new Map<string, ActivePackage>();
    const nextPending = new Map<string, PendingPackage>();
    const nextFailures = new Map<string, PackageFailure>();
    const toDispose: RegistrationBag[] = [];
    const toCommit: PackageActivation[] = [];
    const pkgDirs: string[] = [];
    const scanErrors = new Map<string, PackageFailure>();

    for (const desc of this.scanDescriptors(scanErrors)) {
      if (desc.pkgDir) pkgDirs.push(desc.pkgDir);
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
        if (existing && this.ownsActiveRuntime(activation, existing)) {
          // Active-runtime change: keep the old package live until applyPending.
          nextActive.set(desc.name, existing);
          nextPending.set(desc.name, {
            descriptor: desc,
            fingerprint,
            revision: this.nextToken(),
            activation: staged,
          });
        } else {
          toCommit.push(staged);
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
      if (nextActive.has(name) || nextFailures.has(name) || committing.has(name)) continue;
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
      this.publishEntries();
      this.snapshotCb?.(this.snapshot);
    }
    this.notifyStateChanged();
    this.refreshDirWatchers();
  }

  private async runApplyPending(name: string): Promise<PluginApplyResult> {
    const pending = this.pending.get(name);
    if (!pending) return { applied: false, error: `no pending revision for "${name}"` };
    if (!pending.activation) {
      return { applied: false, error: pending.error ?? `pending revision for "${name}" is invalid` };
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
    this.publishEntries();
    this.snapshotCb?.(this.snapshot);
    this.notifyStateChanged();
    return { applied: true, revision };
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
    const records = [...this.active.values()].sort((a, b) => a.descriptor.name.localeCompare(b.descriptor.name));
    for (const record of records) {
      const entries = record.entries;
      if (entries.runtime) runtime.push(entries.runtime);
      if (entries.media) media.push(entries.media);
      if (entries.tts) tts.push(entries.tts);
      if (entries.usage) usage.push(entries.usage);
    }
    this.lastRuntime = runtime;
    this.lastMedia = media;
    this.lastTts = tts;
    this.lastUsage = usage;
    this.runtimeCb?.(runtime);
    this.mediaCb?.(media);
    this.ttsCb?.(tts);
    this.usageCb?.(usage);
  }

  private notifyStateChanged(): void {
    const signature = JSON.stringify(this.getState());
    if (signature === this.lastStateSignature) return;
    this.lastStateSignature = signature;
    this.stateCb?.();
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
  private ownsActiveRuntime(activation: ActivationResult | undefined, existing: ActivePackage): boolean {
    const active = this.activeRuntimeName();
    if (!active) return false;
    const candidate = activation?.entries.runtime?.name;
    const current = existing.entries.runtime?.name;
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

  /** 枚举候选包；逐条错误记入 errorStates（不抛出）。 */
  private scanDescriptors(errorStates: Map<string, PackageFailure>): PackageDescriptor[] {
    const out: PackageDescriptor[] = [];
    if (!fs.existsSync(this.dir)) return out;
    const entries = fs.readdirSync(this.dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      try {
        if (entry.isFile() && entry.name.endsWith('.js')) {
          out.push({ name: entry.name.replace(/\.js$/, ''), mainFile: path.join(this.dir, entry.name) });
        } else if (entry.isDirectory()) {
          const pkgDir = path.join(this.dir, entry.name);
          const manifestPath = path.join(pkgDir, 'plugin.json');
          let manifest: PackageManifest | undefined;
          if (fs.existsSync(manifestPath)) {
            manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
          }
          const mainFile = path.join(pkgDir, manifest?.main ?? 'index.js');
          if (!fs.existsSync(mainFile)) throw new Error(`main file not found: ${manifest?.main ?? 'index.js'}`);
          out.push({ name: manifest?.name ?? entry.name, mainFile, manifest, pkgDir });
        }
      } catch (err: any) {
        errorStates.set(entry.name, { source: path.join(this.dir, entry.name), error: err.message });
      }
    }
    return out;
  }

  private async activate(desc: PackageDescriptor, bag: RegistrationBag): Promise<ActivationResult> {
    // One activate() result = one bag = one revision. The bag is empty until the
    // action/event registries attach their cleanups, so the per-package lifecycle
    // has exactly one owner from the first scan onwards.
    void bag;
    this.invalidatePackageCache(desc);
    const mod = require(desc.mainFile);
    const modName = mod?.name;
    if (typeof modName !== 'string' || !modName) throw new Error('missing name');
    if (modName !== desc.name) throw new Error(`name mismatch: exports '${modName}', package '${desc.name}'`);
    const ctx = this.createContext(modName);
    const raw: UnifiedPluginContributions =
      typeof mod.activate === 'function' ? ((await mod.activate(ctx)) ?? {}) : pickContributions(mod);

    // Declarative half is validated before anything is published; legacy
    // contributions are the same object with `ui`/`actions`/`events` removed.
    const built = buildActivatedContributions(modName, raw, this.canonicalTypes);
    if (!built.ok) throw new Error(`invalid contributions: ${built.errors.join('; ')}`);
    const activated = built.value;
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
        capabilities: spec.capabilities,
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
    if (hasUiSlots(activated.ui)) kinds.push('ui');

    if (kinds.length === 0) throw new Error('no contributions (usage/media/runtime/tts/uiTools/ui/actions/events)');

    return {
      version: desc.manifest?.version,
      contributions: kinds,
      activated,
      entries: { runtime, media, tts, usage },
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
- \`ctx.pluginConfig()\` —— 读 config.yaml \`plugins.<name>.config\`（回退 legacy 三段 pluginConfig）
- \`ctx.projectDir\` / \`ctx.gatewayPort\` / \`ctx.usage.modelStats({sinceMs?, provider?})\`

## 优先级

同名时：**包 > legacy 目录文件（usage-plugins/ media-plugins/ runtime-plugins/）> 内置**。
legacy 目录行为不变。reload 清变更包的本地模块子树；改动会按内容指纹自动热重载。
`;
