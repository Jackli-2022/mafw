/**
 * `@mafw/adapter-opencode` — the opencode runtime driver.
 *
 * Package identity plus the pure driver modules extracted from the gateway
 * (Plan 6 Task 5): canonical message shaping, dialect event tables, history
 * translation, snapshot/channel lookup, MCP runtime + JSONC config, credential
 * and provider-settings readers, and the serve sidecar.
 *
 * The stateful assembler (`opencode-adapter.ts` / `opencode-runtime.ts` /
 * `opencode-definition.ts`) stays in the gateway until Task 6; the gateway
 * keeps one-release re-export shims at the old module paths.
 */
import { ADAPTER_EVENT_VERSION } from '@mafw/runtime-contract';

export * from './types';
export * from './canonical';
export * from './events';
export * from './events-21';
export * from './history';
export * from './snapshot';
export * from './mcp';
export * from './mcp-config';
export * from './mcp-jsonc';
export * from './dialect-probe';
export * from './form-question';
export * from './provider-settings';
export * from './auth';
export * from './serve-sidecar';

/** Package identity used by the gateway shim and the stage manifests. */
export const ADAPTER_PACKAGE_NAME = '@mafw/adapter-opencode';

/** Runtime name the opencode driver registers under. */
export const OPENCODE_RUNTIME_NAME = 'opencode';

/** Dialect variants the driver can pin or probe for. */
export type OpencodeVariant = 'adaptive' | 'v1' | 'v2' | 'v21';

/** Every dialect variant, in probe preference order. */
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
