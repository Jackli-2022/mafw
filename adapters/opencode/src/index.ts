/**
 * `@mafw/adapter-opencode` — the opencode runtime driver.
 *
 * This entry is a placeholder: Task 4 only creates the package and its
 * build/stage wiring. The driver modules (`events`, `history`, `mcp`,
 * `serve-sidecar`, `definition`, …) move here in the following tasks, and this
 * file then re-exports the real surface. Until then it exports the identity
 * constants plus the SDK loader the extracted driver is built around.
 */
import { ADAPTER_EVENT_VERSION } from '@mafw/runtime-contract';

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
