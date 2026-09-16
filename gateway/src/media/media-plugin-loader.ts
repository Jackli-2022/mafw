import * as fs from 'fs';
import * as path from 'path';
import { log } from '../core/utils/logger';
import { PromptFn } from './media-service';
import { createPiPromptAdapter } from './pi-adapter';
import { createMediaPluginContext } from './plugin-context';
import type { RuntimeCredentials } from '../runtime/contract';
import type { MediaPackageEntry } from '../plugins/package-types';

export interface MediaEngine {
  prompt: PromptFn;
  modalities: string[];
  builtin?: boolean;
  /** 贡献来源（包条目填充；legacy/内置缺省） */
  source?: string;
}

export interface MediaPluginState {
  file: string;
  name?: string;
  status: 'ok' | 'error';
  error?: string;
  modalities?: string[];
}

const VALID_MODALITIES = new Set(['image', 'video', 'audio']);

export interface MediaPluginLoaderOpts {
  /** Lazy credentials getter (resolved at plugin-load time, not construction time). */
  getCredentials?: () => RuntimeCredentials | undefined;
}

export class MediaPluginLoader {
  private pluginsDir: string;
  private state = new Map<string, MediaPluginState>();
  private engines = new Map<string, MediaEngine>();
  private builtinEngines = new Map<string, MediaEngine>();
  private packageEngines = new Map<string, MediaPackageEntry>();
  private watcher?: fs.FSWatcher;
  private debounceTimer?: NodeJS.Timeout;
  private getCredentials?: () => RuntimeCredentials | undefined;

  constructor(pluginsDir: string, opts?: MediaPluginLoaderOpts) {
    this.pluginsDir = pluginsDir;
    this.getCredentials = opts?.getCredentials;
  }

  async init(): Promise<void> {
    this.ensureDir();
    await this.scan();
    this.startWatch();
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.pluginsDir)) {
      fs.mkdirSync(this.pluginsDir, { recursive: true });
      fs.writeFileSync(path.join(this.pluginsDir, 'README.md'), README_CONTENT);
      log.info(`[MediaPluginLoader] Created ${this.pluginsDir}`);
    }
  }

  private async scan(): Promise<void> {
    if (!fs.existsSync(this.pluginsDir)) return;
    const files = fs.readdirSync(this.pluginsDir).filter(f => f.endsWith('.js'));
    const seen = new Set<string>();
    const loadedNames = new Set<string>();
    for (const file of files.sort()) {
      await this.loadFile(file, loadedNames);
      seen.add(file);
    }
    for (const [file] of this.state) {
      if (!seen.has(file)) {
        const prev = this.state.get(file);
        if (prev?.name) this.engines.delete(prev.name);
        this.state.delete(file);
      }
    }
  }

  private async loadFile(file: string, loadedNames: Set<string>): Promise<void> {
    const fullPath = path.join(this.pluginsDir, file);
    try {
      const cacheKey = require.resolve(fullPath);
      delete require.cache[cacheKey];
    } catch { /* first load */ }

    try {
      const mod = require(fullPath);
      const name = mod?.name;
      if (!name || typeof name !== 'string') {
        this.state.set(file, { file, status: 'error', error: 'missing name' });
        return;
      }
      const modalities = mod?.modalities;
      if (!Array.isArray(modalities) || modalities.length === 0 || !modalities.every((m: string) => VALID_MODALITIES.has(m))) {
        this.state.set(file, { file, name, status: 'error', error: 'invalid modalities' });
        return;
      }
      const hasCreatePrompt = typeof mod.createPrompt === 'function';
      const hasPiEngine = mod.engine === 'pi';
      if (!hasCreatePrompt && !hasPiEngine) {
        this.state.set(file, { file, name, status: 'error', error: 'missing createPrompt() or engine:"pi"' });
        return;
      }
      if (hasCreatePrompt && hasPiEngine) {
        this.state.set(file, { file, name, status: 'error', error: 'createPrompt and engine:"pi" are mutually exclusive' });
        return;
      }
      if (loadedNames.has(name)) {
        this.state.set(file, { file, name, status: 'error', error: 'duplicate name' });
        log.warn(`[MediaPluginLoader] ${file}: duplicate name '${name}', skipping`);
        return;
      }

      let prompt: PromptFn;
      const creds = this.getCredentials?.();
      if (hasCreatePrompt) {
        const ctx = createMediaPluginContext(name, creds);
        prompt = await mod.createPrompt(ctx);
        if (typeof prompt !== 'function') {
          this.state.set(file, { file, name, status: 'error', error: 'createPrompt did not return a function' });
          return;
        }
      } else {
        const fixPayload = typeof mod.fixPayload === 'function' ? mod.fixPayload : undefined;
        prompt = createPiPromptAdapter({ fixPayload, credentials: creds });
      }

      loadedNames.add(name);
      this.engines.set(name, { prompt, modalities });
      this.state.set(file, { file, name, status: 'ok', modalities });
      log.info(`[MediaPluginLoader] Loaded ${file} (${name}, modalities: ${modalities.join(',')})`);
    } catch (err: any) {
      const prev = this.state.get(file);
      this.state.set(file, {
        file,
        name: prev?.name,
        status: 'error',
        error: err.message,
      });
      log.warn(`[MediaPluginLoader] ${file} load error: ${err.message}`);
    }
  }

  /** 内置引擎登记（如 pi）。prompt 是占位——真正的内置路径由 resolveMediaPrompt 在调用点解析。 */
  registerBuiltinEngine(name: string, modalities: string[]): void {
    this.builtinEngines.set(name, {
      prompt: (async () => { throw new Error('builtin engine prompt is resolved at call site'); }) as PromptFn,
      modalities,
      builtin: true,
    });
  }

  getBuiltinEngineNames(): string[] {
    return [...this.builtinEngines.keys()];
  }

  /** PluginHost 推送的包贡献。同名覆盖 legacy 与内置。 */
  setPackageEntries(entries: MediaPackageEntry[]): void {
    this.packageEngines = new Map(entries.map((e) => [e.name, e]));
  }

  getEngines(): Map<string, MediaEngine> {
    // 合并顺序：内置 → legacy 文件 → 包（后者覆盖前者同名）
    const merged = new Map<string, MediaEngine>(this.builtinEngines);
    for (const [name, e] of this.engines) merged.set(name, e);
    for (const [name, e] of this.packageEngines) {
      merged.set(name, { prompt: e.prompt, modalities: e.modalities, source: e.source });
    }
    return merged;
  }

  getState(): MediaPluginState[] {
    return [...this.state.values()];
  }

  async reload(): Promise<void> {
    await this.scan();
  }

  private startWatch(): void {
    if (!fs.existsSync(this.pluginsDir)) return;
    try {
      this.watcher = fs.watch(this.pluginsDir, () => {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(async () => {
          if (!fs.existsSync(this.pluginsDir)) {
            log.warn(`[MediaPluginLoader] plugins dir deleted, stopping watch`);
            this.watcher?.close();
            this.watcher = undefined;
            return;
          }
          await this.scan();
        }, 300);
      });
    } catch (err: any) {
      log.warn(`[MediaPluginLoader] watch failed: ${err.message}`);
    }
  }

  stop(): void {
    this.watcher?.close();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }
}

const README_CONTENT = `# Media Engine Plugins

Place \`.js\` files here to add custom media analysis engines. Two forms:

## Form A: Custom Engine (full control)

\`\`\`js
module.exports = {
  name: "gemini-vision",
  modalities: ["image", "video"],
  async createPrompt(ctx) {
    const key = ctx.apiKey("google");
    return async (parts, opts) => {
      // parts: [{type:'file', mime, url: 'data:...'}, {type:'text', text}]
      // opts: { providerID, modelID }
      // Return analysis text.
      const res = await ctx.fetch("https://api.example.com/analyze", {
        method: "POST",
        headers: { Authorization: \`Bearer \${key}\` },
        body: JSON.stringify({ parts }),
      });
      const data = await res.json();
      return data.result;
    };
  },
};
\`\`\`

## Form B: Pi Engine with Custom Wire Fixer

\`\`\`js
module.exports = {
  name: "qwen-vl",
  modalities: ["image", "video"],
  engine: "pi",
  fixPayload(payload) {
    // Rewrite wire format for your provider. Return undefined for no change.
    return payload;
  },
};
\`\`\`

**ctx methods:**
- \`ctx.apiKey(name)\` — read provider key from opencode auth.json
- \`ctx.fetch(url, opts)\` — fetch with 60s timeout
- \`ctx.pluginConfig(name)\` — read media.pluginConfig[name] from config
- \`ctx.log\` — gateway logger

Select engine per modality in config:
\`\`\`yaml
media:
  engine: pi              # default
  video:
    engine: qwen-vl       # override for video
\`\`\`
`;

