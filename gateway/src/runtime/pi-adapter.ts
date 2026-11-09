/**
 * Gateway entry for the pi adapter. The package is a CJS bundle; this shim is
 * the only place the gateway resolves it by name.
 */
import type { RuntimeCapabilities, RuntimeDefinition, RuntimeFactoryContext } from '@mafw/runtime-contract';

interface AdapterPiModule {
  createPiDefinition(ctx: RuntimeFactoryContext, deps?: unknown): Promise<RuntimeDefinition>;
  PI_CAPABILITIES: RuntimeCapabilities;
  PI_DEFINITION_NAME: string;
  setPiUnknownRecorder(fn: ((type: string) => void) | undefined): void;
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mod = require('@mafw/adapter-pi') as AdapterPiModule;

export const createPiDefinition = mod.createPiDefinition;
export const PI_CAPABILITIES = mod.PI_CAPABILITIES;
export const PI_DEFINITION_NAME = mod.PI_DEFINITION_NAME;
export const setPiUnknownRecorder = mod.setPiUnknownRecorder;
