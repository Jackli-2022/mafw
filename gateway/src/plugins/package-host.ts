/**
 * 统一插件包宿主 —— 扫 ~/.mafw/plugins/（单文件包 *.js / 目录包 plugin.json+入口），
 * 激活后把贡献分发给三个 legacy loader（setPackageEntries）。fail-open。
 * 优先级（同名）：包 > legacy 目录文件 > 内置。
 */
import * as fs from 'fs';
import * as path from 'path';
import { log } from '../core/utils/logger';
import { createPiPromptAdapter } from '../media/pi-adapter';
import type {
  MediaPackageEntry, PackageDescriptor, PackageManifest, PackageState,
  PluginContributions, PluginPackageContext, RuntimePackageEntry, TtsPackageEntry, UsagePackageEntry,
} from './package-types';
import type { PcmChunk, TtsEngine, TtsOpts } from '../tts/types';

const VALID_MODALITIES = new Set(['image', 'video', 'audio']);

export class PluginHost {
  private state = new Map<string, PackageState>();
  private watcher?: fs.FSWatcher;
  private dirWatchers = new Map<string, fs.FSWatcher>();
  private debounce?: NodeJS.Timeout;
  /** 当前目录包的子目录绝对路径（refreshDirWatchers 用） */
  private pkgDirs: string[] = [];
  private runtimeCb?: (entries: RuntimePackageEntry[]) => void;
  private mediaCb?: (entries: MediaPackageEntry[]) => void;
  private ttsCb?: (entries: TtsPackageEntry[]) => void;
  private usageCb?: (entries: UsagePackageEntry[]) => void;
  private lastRuntime: RuntimePackageEntry[] = [];
  private lastMedia: MediaPackageEntry[] = [];
  private lastTts: TtsPackageEntry[] = [];
  private lastUsage: UsagePackageEntry[] = [];

  constructor(
    private dir: string,
    private createContext: (name: string) => PluginPackageContext,
  ) {}

  bindRuntime(cb: (entries: RuntimePackageEntry[]) => void): void { this.runtimeCb = cb; cb(this.lastRuntime); }
  bindMedia(cb: (entries: MediaPackageEntry[]) => void): void { this.mediaCb = cb; cb(this.lastMedia); }
  bindTts(cb: (entries: TtsPackageEntry[]) => void): void { this.ttsCb = cb; cb(this.lastTts); }
  bindUsage(cb: (entries: UsagePackageEntry[]) => void): void { this.usageCb = cb; cb(this.lastUsage); }

  async init(): Promise<void> {
    this.ensureDir();
    await this.reload();
    this.startWatch();
  }

  getState(): PackageState[] {
    return [...this.state.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  stop(): void {
    this.watcher?.close();
    for (const w of this.dirWatchers.values()) w.close();
    this.dirWatchers.clear();
    if (this.debounce) clearTimeout(this.debounce);
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(path.join(this.dir, 'README.md'), README_CONTENT);
      log.info(`[PluginHost] Created ${this.dir}`);
    }
  }

  /** 全量重扫 + 重新激活 + 一次性推送（跨面原子：先全部激活完再推各 loader）。 */
  async reload(): Promise<void> {
    const next = new Map<string, PackageState>();
    const runtime: RuntimePackageEntry[] = [];
    const media: MediaPackageEntry[] = [];
    const tts: TtsPackageEntry[] = [];
    const usage: UsagePackageEntry[] = [];
    const pkgDirs: string[] = [];
    for (const desc of this.scanDescriptors(next)) {
      if (desc.pkgDir) pkgDirs.push(desc.pkgDir);
      try {
        const c = await this.activate(desc);
        if (c.runtime) runtime.push(c.runtime);
        if (c.media) media.push(c.media);
        if (c.tts) tts.push(c.tts);
        if (c.usage) usage.push(c.usage);
        next.set(desc.name, {
          name: desc.name, source: desc.mainFile, status: 'ok',
          contributions: c.contributions, version: desc.manifest?.version,
        });
      } catch (err: any) {
        next.set(desc.name, { name: desc.name, source: desc.mainFile, status: 'error', error: err.message, contributions: [] });
        log.warn(`[PluginHost] ${desc.name} activate error: ${err.message}`);
      }
    }
    this.state = next;
    this.pkgDirs = pkgDirs;
    this.lastRuntime = runtime;
    this.lastMedia = media;
    this.lastTts = tts;
    this.lastUsage = usage;
    this.runtimeCb?.(runtime);
    this.mediaCb?.(media);
    this.ttsCb?.(tts);
    this.usageCb?.(usage);
    this.refreshDirWatchers();
  }

  /** 每个目录包一个 watcher（跨平台——不用 recursive）。reload 后按当前包集合增删。 */
  private refreshDirWatchers(): void {
    if (!this.watcher) return; // 顶层 watch 未建立（init 前手动 reload）则不建
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
  private scanDescriptors(errorStates: Map<string, PackageState>): PackageDescriptor[] {
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
        errorStates.set(entry.name, { name: entry.name, source: path.join(this.dir, entry.name), status: 'error', error: err.message, contributions: [] });
      }
    }
    return out;
  }

  private async activate(desc: PackageDescriptor): Promise<{
    contributions: string[];
    runtime?: RuntimePackageEntry;
    media?: MediaPackageEntry;
    tts?: TtsPackageEntry;
    usage?: UsagePackageEntry;
  }> {
    try { delete require.cache[require.resolve(desc.mainFile)]; } catch { /* first load */ }
    const mod = require(desc.mainFile);
    const modName = mod?.name;
    if (typeof modName !== 'string' || !modName) throw new Error('missing name');
    if (modName !== desc.name) throw new Error(`name mismatch: exports '${modName}', package '${desc.name}'`);
    const ctx = this.createContext(modName);
    const contribs: PluginContributions =
      typeof mod.activate === 'function' ? ((await mod.activate(ctx)) ?? {}) : pickContributions(mod);
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
        : createPiPromptAdapter({ fixPayload: spec.fixPayload, credentials: ctx.credentials });
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
    if (kinds.length === 0) throw new Error('no contributions (usage/media/runtime/tts/uiTools)');
    return { contributions: kinds, runtime, media, tts, usage };
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
legacy 目录行为不变。reload 只清主文件的 require.cache——改包内 lib/ 共享代码需 \`mafw restart\`。
`;
