/**
 * Gateway entry for the pi adapter. The package is a CJS bundle; this shim is
 * the only place the gateway resolves it by name.
 *
 * Loading is fail-soft: a missing/partial staging must not crash gateway boot
 * for users running another runtime. Capabilities fall back to all-false, and
 * activation throws a diagnosable error that lets the composition root fall
 * back to opencode.
 */
import type { RuntimeCapabilities, RuntimeDefinition, RuntimeFactoryContext } from '@mafw/runtime-contract';

interface AdapterPiModule {
  createPiDefinition(ctx: RuntimeFactoryContext, deps?: unknown): Promise<RuntimeDefinition>;
  PI_CAPABILITIES: RuntimeCapabilities;
  PI_DEFINITION_NAME: string;
  setPiUnknownRecorder(fn: ((type: string) => void) | undefined): void;
}

const FALLBACK_CAPABILITIES: RuntimeCapabilities = {
  sessionApi: false,
  promptWhileBusy: false,
  eventStream: false,
  nativeApprovals: false,
  providerConfigApi: false,
  perLlmCallTransform: false,
};

let cached: AdapterPiModule | undefined;
let loadError: unknown;

function adapter(): AdapterPiModule | undefined {
  if (cached) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cached = require('@mafw/adapter-pi') as AdapterPiModule;
  } catch (err) {
    loadError = err;
  }
  return cached;
}

export const PI_DEFINITION_NAME = 'pi';
export const PI_CAPABILITIES: RuntimeCapabilities = adapter()?.PI_CAPABILITIES ?? FALLBACK_CAPABILITIES;

export function createPiDefinition(
  ctx: RuntimeFactoryContext,
  deps?: unknown,
): Promise<RuntimeDefinition> {
  const mod = adapter();
  if (!mod) {
    throw new Error(
      `@mafw/adapter-pi is not available (${loadError instanceof Error ? loadError.message : String(loadError)})`,
    );
  }
  return mod.createPiDefinition(ctx, deps);
}

export function setPiUnknownRecorder(fn: ((type: string) => void) | undefined): void {
  try {
    adapter()?.setPiUnknownRecorder(fn);
  } catch { /* telemetry must not block boot */ }
}
