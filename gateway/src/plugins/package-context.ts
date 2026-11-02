import { config } from '../config';
import { log } from '../core/utils/logger';
import type { UsageStatsProvider } from '../usage/plugin-context';
import type { PluginPackageContext } from './package-types';

export interface PackageContextDeps {
  /** thunk 惰性求值（host 初始化时 runtime/trajStore 可能尚未就绪） */
  getApiKey?: (provider: string) => string | null;
  usageStats?: () => UsageStatsProvider | undefined;
  projectDir: string;
  gatewayPort: number;
  /** gateway 全通道广播（缺省 no-op——测试/独立宿主场景） */
  emit?: (event: { type: string; [key: string]: any }) => void;
  /**
   * 持久化 `plugins.<package>.config` 覆盖（gateway 注入
   * `config.persistOverrides`）。缺省时 `ctx.config.update` 抛错而不是静默丢弃。
   */
  persistConfig?: (overrides: Record<string, unknown>) => void;
}

const EMPTY_USAGE: UsageStatsProvider = { modelStats: () => [] };

const FORBIDDEN_KEY_NAMES = new Set(['__proto__', 'prototype', 'constructor']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Rejects patches that cannot round-trip through YAML/JSON or that would let a
 * package reach into the prototype chain.
 */
function assertSafePatch(value: unknown, path: string, seen: WeakSet<object>): void {
  if (value === null) return;
  const kind = typeof value;
  if (kind === 'string' || kind === 'boolean') return;
  if (kind === 'number') {
    if (!Number.isFinite(value as number)) throw new TypeError(`${path} must be a finite number`);
    return;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError(`${path} must be JSON-serializable (circular reference)`);
    seen.add(value);
    value.forEach((item, index) => assertSafePatch(item, `${path}[${index}]`, seen));
    return;
  }
  if (kind === 'object') {
    const record = value as Record<string, unknown>;
    if (seen.has(record)) throw new TypeError(`${path} must be JSON-serializable (circular reference)`);
    seen.add(record);
    for (const key of Object.keys(record)) {
      if (FORBIDDEN_KEY_NAMES.has(key)) throw new TypeError(`${path}.${key} is not allowed`);
      assertSafePatch(record[key], `${path}.${key}`, seen);
    }
    return;
  }
  throw new TypeError(`${path} must be JSON-serializable (got ${kind})`);
}

function readLegacyFallback(name: string): Record<string, any> {
  const raw = config.raw as any;
  return raw?.usage?.pluginConfig?.[name]
    ?? raw?.media?.pluginConfig?.[name]
    ?? raw?.runtime?.pluginConfig?.[name]
    ?? {};
}

export function createPluginPackageContext(name: string, deps: PackageContextDeps): PluginPackageContext {
  /** 每次都重新读 config.raw——热重载/ctx.config.update 后必须立刻可见。 */
  const readPluginConfig = (): Record<string, any> =>
    (config.raw as any)?.plugins?.[name]?.config ?? readLegacyFallback(name);

  return {
    log,
    fetch: (url, opts) => fetch(url, { ...opts, signal: opts?.signal ?? AbortSignal.timeout(60_000) }),
    apiKey: (provider) => deps.getApiKey?.(provider) ?? null,
    pluginConfig: readPluginConfig,
    config: {
      update: (patch) => {
        if (FORBIDDEN_KEY_NAMES.has(name)) {
          throw new TypeError(`package name "${name}" cannot be used as a config key`);
        }
        if (!isPlainObject(patch)) {
          throw new TypeError('ctx.config.update(patch) requires a plain object');
        }
        assertSafePatch(patch, `plugins.${name}.config`, new WeakSet());
        if (!deps.persistConfig) {
          throw new Error('ctx.config.update is not available in this host');
        }
        const next = { ...readPluginConfig(), ...patch };
        // The patch may only ever land under this package's namespace: the
        // override object has exactly one top-level key (`plugins`).
        deps.persistConfig({ plugins: { [name]: { config: next } } });
      },
    },
    credentials: undefined,
    projectDir: deps.projectDir,
    gatewayPort: deps.gatewayPort,
    usage: deps.usageStats?.() ?? EMPTY_USAGE,
    emit: (event) => deps.emit?.(event),
  };
}
