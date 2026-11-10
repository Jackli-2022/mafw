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
import { minimalCapabilities } from './contract';
import type { EventMappingEntry } from './event-mapper';
import { setBridgeEventEntryProvider } from './legacy-plugin-bridge';

interface AdapterOpencodeModule {
  createOpencodeDefinition(
    ctx: RuntimeFactoryContext,
    opts: OpencodeDefinitionOptions,
    deps?: OpencodeDefinitionDeps,
  ): Promise<RuntimeDefinition>;
  opencodeStaticEntry(variant: OpencodeVariant): EventMappingEntry;
  opencodeCapabilities(variant: OpencodeVariant, external: boolean): RuntimeCapabilities;
  OPENCODE_REGISTRATIONS: readonly { name: string; variant: OpencodeVariant }[];
  opencodeDiscoveryRoots(): { skillRoots?: string[]; instructionRoots?: string[] };
  getBridgeEventEntry(name: string): EventMappingEntry | undefined;
  setBridgeEventEntry(name: string, entry: EventMappingEntry): void;
}

const FALLBACK_CAPABILITIES: RuntimeCapabilities = {
  ...minimalCapabilities(),
  sessionApi: false,
  promptWhileBusy: false,
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

/** Adapter-owned registration descriptors (name + dialect variant). */
export const OPENCODE_REGISTRATIONS: readonly { name: string; variant: OpencodeVariant }[] =
  loaded?.OPENCODE_REGISTRATIONS ?? [];

/** Discovered skill/instruction roots (gateway core stops hardcoding vendor paths). */
export function opencodeDiscoveryRoots(): { skillRoots?: string[]; instructionRoots?: string[] } {
  return loaded?.opencodeDiscoveryRoots() ?? {};
}

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

export function getBridgeEventEntry(name: string): EventMappingEntry | undefined {
  return loaded?.getBridgeEventEntry(name);
}

export type { OpencodeVariant };
