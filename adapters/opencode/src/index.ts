/**
 * `@mafw/adapter-opencode` — the opencode runtime driver.
 *
 * Package identity plus the full driver surface (Plan 6 Task 6): the legacy
 * adapter client, the serve lifecycle runtime, the neutral definition assembly
 * and the dialect event tables.
 *
 * Adapter source may import `@mafw/runtime-contract`, `@mafw/runtime-core`,
 * `@opencode-ai/sdk`, `jsonc-parser`, `cross-spawn`, Node builtins and local
 * modules only — never the gateway.
 */
import { ADAPTER_EVENT_VERSION } from '@mafw/runtime-contract';
import type { OpencodeVariant } from './definition';

export * from './types';
export * from './canonical';
export * from './events';
export * from './events-21';
export { OPENCODE_CANONICAL_TYPES, nextOpencodeEventID, toAdapterEvent } from './emit';
export type { EmitContext } from './emit';
export * from './turn-attribution';
export * from './history';
export * from './snapshot';
export * from './discovery-roots';
export * from './mcp';
export * from './mcp-config';
export * from './mcp-jsonc';
export * from './dialect-probe';
export * from './form-question';
export * from './provider-settings';
export * from './auth';
export * from './serve-sidecar';
export * from './adapter';
export * from './runtime';
export * from './transport';
export * from './channels';
export * from './host';
export * from './entry-registry';
export * from './registration';
export * from './definition';

/** Package identity used by the gateway shim and the stage manifests. */
export const ADAPTER_PACKAGE_NAME = '@mafw/adapter-opencode';

/** Runtime name the opencode driver registers under. */
export const OPENCODE_RUNTIME_NAME = 'opencode';

/** Dialect variants the driver can pin or probe for. */
export const OPENCODE_VARIANTS: readonly OpencodeVariant[] = ['adaptive', 'v1', 'v2', 'v21'];

/** `AdapterEvent` schema version this build expects from the host. */
export const ADAPTER_EVENT_API_VERSION = ADAPTER_EVENT_VERSION;

/**
 * Loads the ESM-only `@opencode-ai/sdk/v2` entry.
 *
 * Keep this a real dynamic `import()` in the CJS bundle: the SDK subpath only
 * exposes an `import` condition, so `require()` throws ERR_REQUIRE_ESM.
 */
export async function loadOpencodeSdkV2(): Promise<unknown> {
  return import('@opencode-ai/sdk/v2');
}
