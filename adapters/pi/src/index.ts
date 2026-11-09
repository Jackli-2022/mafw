import type { RuntimeCapabilities, RuntimeDefinition, RuntimeFactoryContext } from '@mafw/runtime-contract';

/** Temporary skeleton; Task 4 replaces this with the real definition. */
export const PI_CAPABILITIES: RuntimeCapabilities = {
  sessionApi: true,
  promptWhileBusy: true,
  eventStream: true,
  nativeApprovals: true,
  providerConfigApi: true,
  perLlmCallTransform: true,
};

export async function createPiDefinition(_ctx: RuntimeFactoryContext): Promise<RuntimeDefinition> {
  throw new Error('adapter-pi: not wired yet');
}

export function setPiUnknownRecorder(_fn: ((type: string) => void) | undefined): void {}
