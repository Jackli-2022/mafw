/**
 * opencode as a neutral runtime definition (all four dialect names).
 *
 * The runtime implementation stays in the gateway until Plan 4; this file is
 * the seam: dialect entry resolution + capability narrowing + bridge wrap.
 */
import type { RuntimeDefinition } from '@mafw/runtime-contract';
import type { AgentRuntime } from './contract';
import { fullCapabilities } from './contract';
import { toRuntimeDefinition } from './adapter-bridge';
import type { EventMappingEntry } from './event-mapper';
import { createOpencodeRuntime } from './opencode-runtime';
import { OPENCODE_EVENT_SOURCE, OPENCODE_V1_EVENT_MAPPINGS, OPENCODE_V2_EVENT_MAPPINGS, OPENCODE_TRANSFORM_EVENT } from './opencode-events';
import { OPENCODE_21_EVENT_SOURCE, OPENCODE_21_EVENT_MAPPINGS, translateOpencode21Event } from './opencode-21-events';
import { probeOpencodeDialect } from './opencode-dialect-probe';

export type OpencodeVariant = 'adaptive' | 'v1' | 'v2' | 'v21';

export interface OpencodeDefinitionOptions {
  variant: OpencodeVariant;
  baseUrl: string;
  headers?: Record<string, string>;
}

export interface OpencodeDefinitionDeps {
  /** Test seam: use this runtime instead of spawning/creating one. */
  runtime?: AgentRuntime;
  /** Test seam: dialect probe override. */
  probe?: (baseUrl: string) => Promise<'v1' | 'v2' | 'v21'>;
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

export function opencodeCapabilities(variant: OpencodeVariant, external: boolean): ReturnType<typeof fullCapabilities> {
  const caps = fullCapabilities();
  if (external) caps.agentProcessApi = false;
  if (variant === 'v1' || variant === 'v2') {
    caps.instructionsApi = false;
    caps.discoveryApi = false;
  }
  return caps;
}

export async function createOpencodeDefinition(
  opts: OpencodeDefinitionOptions,
  deps: OpencodeDefinitionDeps = {},
): Promise<RuntimeDefinition> {
  const external = !!process.env.MAFW_SERVER_SERVE_URL;
  const runtime = deps.runtime ?? await createOpencodeRuntime({
    baseUrl: opts.baseUrl,
    headers: opts.headers ? { ...opts.headers } : undefined,
    dialectProbe: opts.variant === 'adaptive',
  });
  const entry = await resolveOpencodeEntry(opts.variant, opts.baseUrl, deps);
  return toRuntimeDefinition(runtime, {
    name: 'opencode',
    displayName: 'opencode',
    capabilities: opencodeCapabilities(opts.variant, external) as unknown as Record<string, unknown>,
    external,
    translate: { entry, isCanonical: (type) => !!type },
  });
}
