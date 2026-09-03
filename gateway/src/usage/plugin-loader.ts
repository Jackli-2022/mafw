import * as fs from 'fs';
import * as path from 'path';
import { log } from '../core/utils/logger';
import { ExternalAdapter } from './types';
import { makeAdapter } from './plugin-context';

export interface ConfigSchemaField {
  key: string;
  label: string;
  type: 'number' | 'string' | 'boolean' | 'select';
  options?: string[];
  default?: string | number | boolean;
}

const SCHEMA_TYPES = new Set(['number', 'string', 'boolean', 'select']);

/** Fail-open: anything malformed → undefined (plugin still loads, no form UI). */
export function validateConfigSchema(raw: unknown): ConfigSchemaField[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: ConfigSchemaField[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return undefined;
    const f = item as Record<string, unknown>;
    if (typeof f.key !== 'string' || !/^[a-zA-Z0-9_]+$/.test(f.key)) return undefined;
    if (typeof f.label !== 'string' || typeof f.type !== 'string' || !SCHEMA_TYPES.has(f.type)) return undefined;
    if (f.type === 'select' && (!Array.isArray(f.options) || f.options.length === 0 || f.options.some(o => typeof o !== 'string'))) return undefined;
    const field: ConfigSchemaField = { key: f.key, label: f.label, type: f.type as ConfigSchemaField['type'] };
    if (Array.isArray(f.options)) field.options = f.options as string[];
    if (f.default !== undefined) field.default = f.default as string | number | boolean;
    out.push(field);
  }
  return out;
}

export interface PluginState {
  file: string;
  name?: string;
  status: 'ok' | 'error';
  error?: string;
  overridden: boolean;
  builtin: boolean;
  adapter?: ExternalAdapter;
  configSchema?: ConfigSchemaField[];
  disabled: boolean;
}

export interface PluginLoaderOptions {
  builtinPluginsDir?: string;
  disabledPlugins?: string[];
}

interface PluginFile {
  fullPath: string;
  file: string;
  builtin: boolean;
}

export class PluginLoader {
  private pluginsDir: string;
  private builtinPluginsDir?: string;
  private disabledPlugins: Set<string>;
  private state = new Map<string, PluginState>();
  private watcher?: fs.FSWatcher;
  private debounceTimer?: NodeJS.Timeout;
  private builtinNames: Set<string>;

  constructor(pluginsDir: string, builtinNames: string[], opts?: PluginLoaderOptions) {
    this.pluginsDir = pluginsDir;
    this.builtinNames = new Set(builtinNames);
    this.builtinPluginsDir = opts?.builtinPluginsDir;
    this.disabledPlugins = new Set(opts?.disabledPlugins ?? []);
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

  private collectFiles(): PluginFile[] {
    const files: PluginFile[] = [];
    if (this.builtinPluginsDir && fs.existsSync(this.builtinPluginsDir)) {
      for (const f of fs.readdirSync(this.builtinPluginsDir).filter(f => f.endsWith('.js')).sort()) {
        files.push({ fullPath: path.join(this.builtinPluginsDir, f), file: f, builtin: true });
      }
    }
    if (fs.existsSync(this.pluginsDir)) {
      for (const f of fs.readdirSync(this.pluginsDir).filter(f => f.endsWith('.js')).sort()) {
        files.push({ fullPath: path.join(this.pluginsDir, f), file: f, builtin: false });
      }
    }
    return files;
  }

  private async scan(): Promise<void> {
    const files = this.collectFiles();
    const builtinNameSet = new Set(this.builtinNames);

    interface LoadedEntry {
      file: string;
      builtin: boolean;
      mod: any;
    }
    const byName = new Map<string, LoadedEntry>();
    const errors: Array<{ file: string; builtin: boolean; error: string }> = [];

    for (const { fullPath, file, builtin } of files) {
      try {
        const cacheKey = require.resolve(fullPath);
        delete require.cache[cacheKey];
      } catch { /* first load */ }

      try {
        const mod = require(fullPath);
        const name = mod?.name;
        if (!name || typeof name !== 'string') {
          errors.push({ file, builtin, error: 'missing name' });
          continue;
        }
        if (typeof mod.fetch !== 'function') {
          errors.push({ file, builtin, error: 'missing fetch()' });
          continue;
        }
        if (builtin) builtinNameSet.add(name);

        const existing = byName.get(name);
        if (existing) {
          if (builtin) {
            // builtin duplicates another loaded name (builtin or user) → error
            errors.push({ file, builtin, error: 'duplicate name' });
            continue;
          }
          if (!existing.builtin) {
            // two user files with same name → error on second
            errors.push({ file, builtin, error: 'duplicate name' });
            continue;
          }
          // user file overrides builtin
          byName.set(name, { file, builtin, mod });
          continue;
        }
        byName.set(name, { file, builtin, mod });
      } catch (err: any) {
        errors.push({ file, builtin, error: err.message });
      }
    }

    this.state.clear();
    for (const [name, entry] of byName) {
      const overridden = !entry.builtin && builtinNameSet.has(name);
      const adapter = makeAdapter(entry.mod, entry.file);
      const configSchema = validateConfigSchema((entry.mod as any).configSchema);
      const disabled = this.disabledPlugins.has(name);
      this.state.set(entry.file, { file: entry.file, name, status: 'ok', overridden, builtin: entry.builtin, adapter, configSchema, disabled });
      log.info(`[PluginLoader] Loaded ${entry.file} (${name})${entry.builtin ? ' [builtin]' : ''}${overridden ? ' [overrides builtin]' : ''}${disabled ? ' [disabled]' : ''}`);
    }
    for (const e of errors) {
      this.state.set(e.file, { file: e.file, status: 'error', error: e.error, overridden: false, builtin: e.builtin, disabled: false });
      log.warn(`[PluginLoader] ${e.file} load error: ${e.error}`);
    }
  }

  getAdapters(): ExternalAdapter[] {
    const adapters: ExternalAdapter[] = [];
    for (const s of this.state.values()) {
      if (s.status === 'ok' && s.adapter && !s.disabled) adapters.push(s.adapter);
    }
    return adapters;
  }

  isBuiltinName(name: string): boolean {
    return this.builtinNames.has(name);
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
  type: "api",             // "api" (balance/limit) or "token-plan" (5h/7d/month windows)
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
      type: "api",
      plan: "My Plan",
      windows: [{
        window: "balance",
        used: data.used,
        limit: data.limit,
        unit: "$",
        pct: Math.round((data.used / data.limit) * 100),
      }],
    };
  },
};
\`\`\`

**Types:**
- \`api\` — credit/balance style (balance window)
- \`token-plan\` — quota windows (5h / 7d / month)

**ctx methods:**
- \`ctx.apiKey(name)\` — read provider key from opencode auth.json
- \`ctx.cookie(name)\` — read usage.cookies[name] from config
- \`ctx.fetch(url, opts)\` — fetch with 10s timeout
- \`ctx.pluginConfig(name)\` — read usage.pluginConfig[name] from config
- \`ctx.log\` — gateway logger

Return \`null\` to hide provider. Builtin plugins live in the package
\`dist/usage/builtin-plugins/\`; drop a file with the same \`name\` here to override,
or add the name to \`usage.disabledPlugins\` in config to disable.
`;

const EXAMPLE_CONTENT = `// Rename to example.js to activate
module.exports = {
  name: "example",
  type: "api",
  plan: "Example Plan",
  async fetch(ctx) {
    return null; // Hide provider
  },
};
`;
