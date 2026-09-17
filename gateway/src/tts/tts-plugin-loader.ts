import * as fs from 'fs';
import * as path from 'path';
import { log } from '../core/utils/logger';
import type { TtsCapabilities, TtsEngine, TtsOpts, TtsVoice, PcmChunk } from './types';

export interface TtsPluginState {
  file: string;
  name?: string;
  status: 'ok' | 'error';
  error?: string;
}

export interface TtsPluginCtx {
  fetch: (url: string, opts?: RequestInit) => Promise<Response>;
  log: typeof log;
  pluginConfig: () => Record<string, any>;
  apiKey: (provider: string) => string | null;
}

const DEFAULT_CAPS: TtsCapabilities = {
  streaming: 'none', voiceCloning: false, styleControl: false, languages: ['zh'], sampleRate: 24000,
};

/**
 * ~/.mafw/tts-plugins/*.js 加载器（CJS 模块，fail-open）。
 * 模块形状：{ name, capabilities?, voices(), synthesize(text,opts,ctx)→Buffer, synthesizeStream?(text,opts,ctx,signal)→AsyncIterable<PcmChunk> }
 * 扫描完成（init/reload/watch 触发）后回调 onChanged，供注册表重新 setLegacyEngines。
 */
export class TtsPluginLoader {
  private state = new Map<string, TtsPluginState>();
  private engines = new Map<string, TtsEngine>();
  private watcher?: fs.FSWatcher;
  private debounceTimer?: NodeJS.Timeout;

  constructor(
    private pluginsDir: string,
    private opts?: { onChanged?: () => void; makeCtx?: (name: string) => TtsPluginCtx },
  ) {}

  async init(): Promise<void> {
    if (!fs.existsSync(this.pluginsDir)) {
      fs.mkdirSync(this.pluginsDir, { recursive: true });
      fs.writeFileSync(path.join(this.pluginsDir, 'README.md'), README_CONTENT);
      log.info(`[TtsPluginLoader] Created ${this.pluginsDir}`);
    }
    await this.scan();
    this.startWatch();
  }

  private defaultCtx(name: string): TtsPluginCtx {
    return {
      fetch: (url, requestOpts) => fetch(url, { ...requestOpts, signal: AbortSignal.timeout(60_000) }),
      log,
      pluginConfig: () => ({}),
      apiKey: () => null,
    };
  }

  private async scan(): Promise<void> {
    if (!fs.existsSync(this.pluginsDir)) return;
    const files = fs.readdirSync(this.pluginsDir).filter(f => f.endsWith('.js'));
    const seen = new Set<string>();
    const loaded = new Set<string>();
    for (const file of files.sort()) {
      await this.loadFile(file, loaded);
      seen.add(file);
    }
    for (const [file, st] of this.state) {
      if (!seen.has(file)) {
        if (st.name) this.engines.delete(st.name);
        this.state.delete(file);
      }
    }
    this.opts?.onChanged?.();
  }

  private async loadFile(file: string, loaded: Set<string>): Promise<void> {
    const fullPath = path.join(this.pluginsDir, file);
    try { delete require.cache[require.resolve(fullPath)]; } catch { /* first load */ }
    try {
      const mod = require(fullPath);
      const name = mod?.name;
      if (!name || typeof name !== 'string') { this.state.set(file, { file, status: 'error', error: 'missing name' }); return; }
      if (typeof mod.synthesize !== 'function') { this.state.set(file, { file, name, status: 'error', error: 'missing synthesize()' }); return; }
      if (loaded.has(name)) { this.state.set(file, { file, name, status: 'error', error: 'duplicate name' }); return; }
      const ctx = this.opts?.makeCtx?.(name) ?? this.defaultCtx(name);
      const caps: TtsCapabilities = { ...DEFAULT_CAPS, ...(mod.capabilities ?? {}) };
      const engine: TtsEngine = {
        name,
        capabilities: caps,
        voices: (): TtsVoice[] => (typeof mod.voices === 'function' ? mod.voices() : []),
        synthesize: (text: string, opts: TtsOpts) => mod.synthesize(text, opts, ctx),
        synthesizeStream: typeof mod.synthesizeStream === 'function'
          ? (text: string, opts: TtsOpts, signal: AbortSignal): AsyncIterable<PcmChunk> => mod.synthesizeStream(text, opts, ctx, signal)
          : async function* (): AsyncIterable<PcmChunk> { throw new Error(`engine "${name}" does not support native streaming`); },
      };
      loaded.add(name);
      this.engines.set(name, engine);
      this.state.set(file, { file, name, status: 'ok' });
      log.info(`[TtsPluginLoader] Loaded ${file} (${name})`);
    } catch (err: any) {
      this.state.set(file, { file, status: 'error', error: err.message });
      log.warn(`[TtsPluginLoader] ${file} load error: ${err.message}`);
    }
  }

  getEngines(): TtsEngine[] { return [...this.engines.values()]; }
  getState(): TtsPluginState[] { return [...this.state.values()]; }
  async reload(): Promise<void> { await this.scan(); }

  private startWatch(): void {
    try {
      this.watcher = fs.watch(this.pluginsDir, () => {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => { void this.scan(); }, 300);
      });
    } catch (err: any) {
      log.warn(`[TtsPluginLoader] watch failed: ${err.message}`);
    }
  }

  stop(): void {
    this.watcher?.close();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }
}

const README_CONTENT = `# TTS Engine Plugins

Place \`.js\` files here to add custom TTS engines (CJS module):

\`\`\`js
module.exports = {
  name: "my-tts",
  capabilities: { streaming: "none", voiceCloning: false, styleControl: false, languages: ["zh"], sampleRate: 24000 },
  voices() { return [{ id: "default", label: "Default", lang: "zh" }]; },
  async synthesize(text, opts, ctx) {
    // return Buffer of wav audio
  },
  // optional native streaming:
  // async *synthesizeStream(text, opts, ctx, signal) { yield { pcm: Buffer, sampleRate: 24000 }; },
};
\`\`\`

Select engine via config: \`media.tts.engine: my-tts\`.
`;
