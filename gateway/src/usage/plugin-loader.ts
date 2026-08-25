import * as fs from 'fs';
import * as path from 'path';
import { log } from '../core/utils/logger';
import { ExternalAdapter } from './external-adapters';
import { makeAdapter } from './plugin-context';

export interface PluginState {
  file: string;
  name?: string;
  status: 'ok' | 'error';
  error?: string;
  overridden: boolean;
  adapter?: ExternalAdapter;
}

export class PluginLoader {
  private pluginsDir: string;
  private state = new Map<string, PluginState>();
  private watcher?: fs.FSWatcher;
  private debounceTimer?: NodeJS.Timeout;
  private builtinNames: Set<string>;

  constructor(pluginsDir: string, builtinNames: string[]) {
    this.pluginsDir = pluginsDir;
    this.builtinNames = new Set(builtinNames);
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
      fs.writeFileSync(path.join(this.pluginsDir, 'example.js.disabled'), EXAMPLE_CONTENT);
      log.info(`[PluginLoader] Created ${this.pluginsDir}`);
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
      if (!seen.has(file)) this.state.delete(file);
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
        this.state.set(file, { file, status: 'error', error: 'missing name', overridden: false });
        return;
      }
      if (typeof mod.fetch !== 'function') {
        this.state.set(file, { file, name, status: 'error', error: 'missing fetch()', overridden: false });
        return;
      }
      if (loadedNames.has(name)) {
        this.state.set(file, { file, name, status: 'error', error: 'duplicate name', overridden: false });
        log.warn(`[PluginLoader] ${file}: duplicate name '${name}', skipping`);
        return;
      }
      loadedNames.add(name);
      const overridden = this.builtinNames.has(name);
      const adapter = makeAdapter(mod, file);
      this.state.set(file, { file, name, status: 'ok', overridden, adapter });
      log.info(`[PluginLoader] Loaded ${file} (${name})${overridden ? ' [overrides builtin]' : ''}`);
    } catch (err: any) {
      const prev = this.state.get(file);
      this.state.set(file, {
        file,
        name: prev?.name,
        status: 'error',
        error: err.message,
        overridden: false,
        adapter: prev?.adapter,
      });
      log.warn(`[PluginLoader] ${file} load error: ${err.message}`);
    }
  }

  getAdapters(): ExternalAdapter[] {
    const adapters: ExternalAdapter[] = [];
    for (const s of this.state.values()) {
      if (s.status === 'ok' && s.adapter) adapters.push(s.adapter);
    }
    return adapters;
  }

  getState(): PluginState[] {
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
            log.warn(`[PluginLoader] plugins dir deleted, stopping watch`);
            this.watcher?.close();
            this.watcher = undefined;
            return;
          }
          await this.scan();
        }, 300);
      });
    } catch (err: any) {
      log.warn(`[PluginLoader] watch failed: ${err.message}`);
    }
  }

  stop(): void {
    this.watcher?.close();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }
}

const README_CONTENT = `# Usage Provider Plugins

Place \`.js\` files here to add custom usage providers. Each file exports:

\`\`\`js
module.exports = {
  name: "my-provider",
  plan: "My Plan",
  async fetch(ctx) {
    const key = ctx.apiKey("my-provider");
    if (!key) return null;
    const res = await ctx.fetch("https://api.example.com/usage", {
      headers: { Authorization: \`Bearer \${key}\` },
    });
    const data = await res.json();
    return {
      name: "my-provider",
      plan: "My Plan",
      windows: [{
        window: "5h",
        used: data.used,
        limit: data.limit,
        unit: "$",
        pct: Math.round((data.used / data.limit) * 100),
      }],
    };
  },
};
\`\`\`

**ctx methods:**
- \`ctx.apiKey(name)\` — read provider key from opencode auth.json
- \`ctx.cookie(name)\` — read usage.cookies[name] from config
- \`ctx.fetch(url, opts)\` — fetch with 10s timeout
- \`ctx.pluginConfig(name)\` — read usage.pluginConfig[name] from config
- \`ctx.log\` — gateway logger

Return \`null\` to hide provider (falls back to local trajectory cost).
`;

const EXAMPLE_CONTENT = `// Rename to example.js to activate
module.exports = {
  name: "example",
  plan: "Example Plan",
  async fetch(ctx) {
    return null; // Hide provider
  },
};
`;
