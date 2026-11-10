/**
 * Gateway entry for the opencode driver. The package is a CJS bundle; this
 * shim is the only place the gateway resolves it by name.
 *
 * Loading is fail-soft (same policy as `pi-adapter.ts`): a missing/partial
 * staging must not crash gateway boot for users running another runtime. The
 * static capability/entry fallbacks keep registration alive; activation throws
 * a diagnosable error that lets the composition root fall back.
 */
import type { RuntimeCapabilities, RuntimeDefinition, RuntimeFactoryContext } from '@mafw/runtime-contract';
import type { OpencodeDefinitionOptions, OpencodeDefinitionDeps, OpencodeVariant } from '@mafw/adapter-opencode';
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

function adapter(): AdapterOpencodeModule | undefined {
  if (cached) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cached = require('@mafw/adapter-opencode') as AdapterOpencodeModule;
    // The adapter keeps its own dry-event map (it cannot import the gateway).
    // Mirror it so getBridgeEventEntry() sees the post-probe dialect entry.
    setBridgeEventEntryProvider({
      get: (name) => cached?.getBridgeEventEntry(name),
      set: (name, entry) => cached?.setBridgeEventEntry(name, entry),
    });
  } catch (err) {
    loadError = err;
  }
  return cached;
}

const loaded = adapter();

export const OPENCODE_RUNTIME_NAME = 'opencode';

function unavailable(): Error {
  return new Error(
    `@mafw/adapter-opencode is not available (${loadError instanceof Error ? loadError.message : String(loadError)})`,
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

export function getProviderApiKey(
  provider: string,
  authPath?: string,
  credentials?: { getApiKey(provider: string): string | null },
): string | undefined {
  return loaded?.getProviderApiKey(provider, authPath, credentials);
}

export function getBridgeEventEntry(name: string): EventMappingEntry | undefined {
  return loaded?.getBridgeEventEntry(name);
}

export type { OpencodeVariant };
