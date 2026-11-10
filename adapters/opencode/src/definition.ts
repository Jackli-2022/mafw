/**
 * opencode as a neutral runtime definition (all four dialect names).
 *
 * Plan 6 Task 6: the definition is assembled inside the adapter package. The
 * gateway composition root only passes its factory context plus the selected
 * variant/registration name; dialect tables, capability narrowing, serve
 * lifecycle and provider transport all stay behind this seam.
 */
import type {
  RuntimeCapabilities,
  RuntimeDefinition,
  RuntimeFactoryContext,
} from '@mafw/runtime-contract';
import { RUNTIME_IDENTITY_TYPES } from '@mafw/runtime-contract';
import type { EventMappingEntry, TranslationHooks } from '@mafw/runtime-core';
import { OPENCODE_EVENT_SOURCE, OPENCODE_V1_EVENT_MAPPINGS, OPENCODE_V2_EVENT_MAPPINGS, OPENCODE_TRANSFORM_EVENT } from './events';
import { OPENCODE_21_EVENT_SOURCE, OPENCODE_21_EVENT_MAPPINGS, translateOpencode21Event } from './events-21';
import { probeOpencodeDialect } from './dialect-probe';
import { serveAuthHeaders } from './serve-sidecar';
import { createOpencodeRuntime } from './runtime';
import { fullCapabilities, type OpencodeRuntime } from './types';
import { toRuntimeDefinition, setBridgeEventEntry } from './legacy-definition';

export type OpencodeVariant = 'adaptive' | 'v1' | 'v2' | 'v21';

export interface OpencodeDefinitionOptions {
  variant: OpencodeVariant;
  baseUrl: string;
  headers?: Record<string, string>;
  /** Loader key when it differs from the runtime name (dry-event/conformance). */
  registrationName?: string;
  /** Translation telemetry hooks (unmatched/suppressed/errors). */
  hooks?: TranslationHooks;
  /** Host-provided provider endpoint overrides for the completion fallback. */
  scanEndpoints?: Record<string, string>;
}

export interface OpencodeDefinitionDeps {
  /** Test seam: use this runtime instead of spawning/creating one. */
  runtime?: OpencodeRuntime;
  /** Test seam: dialect probe override. */
  probe?: (baseUrl: string) => Promise<'v1' | 'v2' | 'v21'>;
  /** Explicit external-mode override (default: `MAFW_SERVER_SERVE_URL`). */
  external?: boolean;
}

const V1_ENTRY: EventMappingEntry = {
  eventSource: OPENCODE_EVENT_SOURCE,
  eventMappings: OPENCODE_V1_EVENT_MAPPINGS,
  transformEvent: OPENCODE_TRANSFORM_EVENT,
};
const V2_ENTRY: EventMappingEntry = {
  eventSource: OPENCODE_EVENT_SOURCE,
  eventMappings: OPENCODE_V2_EVENT_MAPPINGS,
  transformEvent: OPENCODE_TRANSFORM_EVENT,
};
const V21_ENTRY: EventMappingEntry = {
  eventSource: OPENCODE_21_EVENT_SOURCE,
  eventMappings: OPENCODE_21_EVENT_MAPPINGS,
  transformEvent: translateOpencode21Event,
};

/** Canonical event vocabulary the driver translates into (explicit per Task 2). */
const CANONICAL_EVENT_TYPES: ReadonlySet<string> = new Set(RUNTIME_IDENTITY_TYPES);

/** Static entry for a pinned variant (tooling/dry-event, no activation needed). */
export function opencodeStaticEntry(variant: OpencodeVariant): EventMappingEntry {
  return variant === 'v21' ? V21_ENTRY : variant === 'v2' ? V2_ENTRY : V1_ENTRY;
}

/**
 * Resolve the event-mapping entry for a variant. `adaptive` probes the serve
 * once (same point in the lifecycle as the legacy facade's rewire) and falls
 * back to the pinned v1 fail-safe when the probe cannot decide.
 */
export async function resolveOpencodeEntry(
  variant: OpencodeVariant,
  baseUrl: string,
  deps: OpencodeDefinitionDeps,
): Promise<EventMappingEntry> {
  if (variant === 'v1') return V1_ENTRY;
  if (variant === 'v2') return V2_ENTRY;
  if (variant === 'v21') return V21_ENTRY;

  const probe = deps.probe ?? ((url: string) => probeOpencodeDialect(url));
  try {
    const dialect = await probe(baseUrl);
    if (dialect === 'v21') return V21_ENTRY;
    if (dialect === 'v2') return V2_ENTRY;
    return V1_ENTRY;
  } catch {
    return V1_ENTRY;
  }
}

export function opencodeCapabilities(variant: OpencodeVariant, external: boolean): RuntimeCapabilities {
  const caps = fullCapabilities();
  if (external) caps.agentProcessApi = false;
  // v1/v2 pre-date instruction entries and the discovery catalog. The HTTP
  // endpoints are dialect-independent, but the event tables are not, so the
  // pinned old dialects keep the old capability surface (documented in Plan 3).
  if (variant === 'v1' || variant === 'v2') {
    caps.instructionsApi = false;
    caps.discoveryApi = false;
  }
  return caps;
}

export async function createOpencodeDefinition(
  ctx: RuntimeFactoryContext,
  opts: OpencodeDefinitionOptions,
  deps: OpencodeDefinitionDeps = {},
): Promise<RuntimeDefinition> {
  const external = deps.external ?? !!process.env.MAFW_SERVER_SERVE_URL;
  const runtime = deps.runtime ?? await createOpencodeRuntime({
    baseUrl: opts.baseUrl,
    headers: opts.headers ? { ...opts.headers } : undefined,
    dialectProbe: opts.variant === 'adaptive',
    external,
    scanEndpoints: opts.scanEndpoints,
  }, ctx);

  const dialectOf = (entry: EventMappingEntry): 'v1' | 'v2' | 'v21' =>
    entry === V21_ENTRY ? 'v21' : entry === V2_ENTRY ? 'v2' : 'v1';
  const staticEntry = opencodeStaticEntry(opts.variant);

  let definition: RuntimeDefinition | undefined;
  definition = toRuntimeDefinition(runtime, {
    name: 'opencode',
    displayName: 'opencode',
    capabilities: opencodeCapabilities(opts.variant, external) as unknown as Record<string, unknown>,
    external,
    entryAlias: opts.registrationName,
    warn: ctx.log?.warn?.bind(ctx.log),
    translate: {
      entry: staticEntry,
      // Adaptive: resolve at first event, after the serve exists. Use the
      // runtime's live base URL (it changes once the sidecar has started).
      ...(opts.variant === 'adaptive'
        ? {
            entryResolver: () => resolveOpencodeEntry(
              opts.variant,
              (runtime as any).getBaseUrl?.() ?? opts.baseUrl,
              deps,
            ),
          }
        : {}),
      isCanonical: (type) => CANONICAL_EVENT_TYPES.has(type),
      ...(opts.hooks ? { hooks: opts.hooks } : {}),
    },
    onEntryResolved: (entry) => {
      if (definition?.host) definition.host.activeDialect = dialectOf(entry);
      if (opts.registrationName) setBridgeEventEntry(opts.registrationName, entry);
      setBridgeEventEntry('opencode', entry);
    },
  });
  if (definition.host) {
    // The gateway reverse proxy reads serve credentials only through this seam.
    definition.host.proxyHeaders = () => ({ ...serveAuthHeaders(), ...(opts.headers ?? {}) });
    if (opts.variant !== 'adaptive') definition.host.activeDialect = dialectOf(staticEntry);
    if (external) delete definition.host.agentProcess;
  }
  return definition;
}
