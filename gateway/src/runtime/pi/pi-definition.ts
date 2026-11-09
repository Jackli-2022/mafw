/**
 * pi as a neutral runtime definition.
 *
 * Wraps the existing in-process pi runtime through the generic adapter bridge;
 * the driver package extraction (adapters/pi) is Plan 3, but the interface the
 * gateway sees is already the neutral one.
 */
import type { RuntimeDefinition } from '@mafw/runtime-contract';
import type { RuntimePluginContext } from '../loader';
import { toRuntimeDefinition } from '../adapter-bridge';
import { createPiRuntime, PI_CAPABILITIES, type PiRuntimeDeps } from '../plugins/pi-runtime';

export const PI_DEFINITION_NAME = 'pi';

export async function createPiDefinition(
  ctx: RuntimePluginContext,
  deps: PiRuntimeDeps = {},
): Promise<RuntimeDefinition> {
  const runtime = await createPiRuntime(ctx, deps);
  return toRuntimeDefinition(runtime, {
    name: PI_DEFINITION_NAME,
    displayName: 'pi',
    capabilities: PI_CAPABILITIES as unknown as Record<string, unknown>,
    // In-process runtime: the gateway never spawns or kills it.
    external: true,
    nativeEvents: true,
  });
}
