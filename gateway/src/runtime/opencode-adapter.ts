/**
 * Gateway entry for the opencode driver. The package is a CJS bundle; this
 * shim is the only place the gateway resolves it by name (Plan 6 Task 7 removed
 * the one-release `opencode-*` re-export shims, so the old gateway import paths
 * are gone for good).
 *
 * Loading is fail-soft (same policy as `pi-adapter.ts`): a missing/partial
 * staging must not crash gateway boot for users running another runtime. The
 * first miss is logged once instead of silently degrading the credential /
 * serve-auth / definition surfaces; static capability/entry fallbacks keep
 * registration alive, and activation throws a diagnosable error that lets the
 * composition root fall back.
 */
import type { RuntimeCapabilities, RuntimeDefinition, RuntimeFactoryContext } from '@mafw/runtime-contract';
import type { OpencodeDefinitionOptions, OpencodeDefinitionDeps, OpencodeVariant } from '@mafw/adapter-opencode';
import { log } from '../core/utils/logger';
import type { EventMappingEntry } from './event-mapper';
import { setBridgeEventEntryProvider } from './adapter-bridge';

interface AdapterOpencodeModule {
  createOpencodeDefinition(
    ctx: RuntimeFactoryContext,
    opts: OpencodeDefinitionOptions,
    deps?: OpencodeDefinitionDeps,
  ): Promise<RuntimeDefinition>;
  opencodeStaticEntry(variant: OpencodeVariant): EventMappingEntry;
  opencodeCapabilities(variant: OpencodeVariant, external: boolean): RuntimeCapabilities;
  getProviderApiKey(
    provider: string,
    authPath?: string,
    credentials?: { getApiKey(provider: string): string | null },
  ): string | undefined;
  getBridgeEventEntry(name: string): EventMappingEntry | undefined;
  setBridgeEventEntry(name: string, entry: EventMappingEntry): void;
  /** Serve Basic-auth headers for the reverse proxy fallback. */
  serveAuthHeaders(): Record<string, string>;
  /** Inline provider settings read from an opencode config document. */
  readProviderApiKey(cfg: unknown, providerID: string): string | null;
  readProviderBaseUrlWithPath(cfg: unknown, providerID: string): string | null;
  readProviderTransportFromList(
    list: unknown,
    providerID: string,
  ): { baseUrl: string | null; apiKey: string | null };
}

const FALLBACK_CAPABILITIES: RuntimeCapabilities = {
  sessionApi: false,
  promptWhileBusy: false,
  eventStream: false,
  nativeApprovals: false,
  providerConfigApi: false,
  perLlmCallTransform: false,
  sessionStorageApi: false,
  agentConfigApi: false,
  agentProcessApi: false,
  completionApi: false,
  sessionBranchApi: false,
  revertUndoApi: false,
  checkpointApi: false,
  runStateApi: false,
  turnBudgetApi: false,
  questionApi: false,
  diffApi: false,
  worktreeApi: false,
  instructionsApi: false,
  discoveryApi: false,
  mcpApi: false,
  mcpConfigApi: false,
  steerApi: false,
  pluginCreatorApi: false,
};

let cached: AdapterOpencodeModule | undefined;
let loadError: unknown;
let warnedMissing = false;

function warnMissingOnce(): void {
  if (warnedMissing) return;
  warnedMissing = true;
  const detail = loadError instanceof Error ? loadError.message : String(loadError);
  try {
    log.warn(
      `[opencode] @mafw/adapter-opencode is not usable (${detail}); `
      + 'opencode definitions, provider credentials and serve auth headers are unavailable',
    );
  } catch {
    /* logging must never block boot */
  }
}

function adapter(): AdapterOpencodeModule | undefined {
  if (cached) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@mafw/adapter-opencode') as AdapterOpencodeModule;
    // Partial staging guard: a half-copied bundle must fail here, visibly,
    // instead of caching a module whose surfaces are `undefined` (activation
    // would otherwise die later with an opaque "not a function").
    if (typeof mod?.createOpencodeDefinition !== 'function') {
      throw new Error('@mafw/adapter-opencode is partially staged: missing createOpencodeDefinition()');
    }
    cached = mod;
    // The adapter keeps its own dry-event map (it cannot import the gateway).
    // Mirror it so getBridgeEventEntry() sees the post-probe dialect entry.
    setBridgeEventEntryProvider({
      get: (name) => cached?.getBridgeEventEntry(name),
      set: (name, entry) => cached?.setBridgeEventEntry(name, entry),
    });
  } catch (err) {
    loadError = err;
    warnMissingOnce();
  }
  return cached;
}

const loaded = adapter();

export const OPENCODE_RUNTIME_NAME = 'opencode';

function unavailable(): Error {
  return new Error(
    `@mafw/adapter-opencode is not usable (${loadError instanceof Error ? loadError.message : String(loadError)})`,
  );
}

export function createOpencodeDefinition(
  ctx: RuntimeFactoryContext,
  opts: OpencodeDefinitionOptions,
  deps?: OpencodeDefinitionDeps,
): Promise<RuntimeDefinition> {
  const mod = adapter();
  if (!mod) return Promise.reject(unavailable());
  return mod.createOpencodeDefinition(ctx, opts, deps);
}

export function opencodeStaticEntry(variant: OpencodeVariant): EventMappingEntry {
  return loaded?.opencodeStaticEntry(variant) ?? {};
}

export function opencodeCapabilities(variant: OpencodeVariant, external: boolean): RuntimeCapabilities {
  return loaded?.opencodeCapabilities(variant, external) ?? FALLBACK_CAPABILITIES;
}

/**
 * `auth.json` credential reader. Unlike the pre-extraction gateway copy this
 * fails soft when the adapter is missing, but it is no longer silent: the
 * package miss is logged once at load (`warnMissingOnce`).
 */
export function getProviderApiKey(
  provider: string,
  authPath?: string,
  credentials?: { getApiKey(provider: string): string | null },
): string | undefined {
  return loaded?.getProviderApiKey(provider, authPath, credentials);
}

/** Serve Basic-auth headers used by the reverse proxy when the host has no seam. */
export function serveAuthHeaders(): Record<string, string> {
  return loaded?.serveAuthHeaders() ?? {};
}

/** Judge/scan fallback: inline `provider.<id>.settings` from the runtime config. */
export function readProviderApiKey(cfg: unknown, providerID: string): string | null {
  return loaded?.readProviderApiKey(cfg, providerID) ?? null;
}

export function readProviderBaseUrlWithPath(cfg: unknown, providerID: string): string | null {
  return loaded?.readProviderBaseUrlWithPath(cfg, providerID) ?? null;
}

export function readProviderTransportFromList(
  list: unknown,
  providerID: string,
): { baseUrl: string | null; apiKey: string | null } {
  return loaded?.readProviderTransportFromList(list, providerID) ?? { baseUrl: null, apiKey: null };
}

export function getBridgeEventEntry(name: string): EventMappingEntry | undefined {
  return loaded?.getBridgeEventEntry(name);
}

export type { OpencodeVariant };
