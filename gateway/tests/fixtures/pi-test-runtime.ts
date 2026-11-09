/**
 * Test seam: build the pi adapter state and wrap its neutral definition in the
 * gateway's neutral runtime facade. The raw registry/event stream stay attached
 * for assertions that must reach native approval bridges or the policy hooks —
 * production code only consumes `definition`.
 */
import type { AgentRuntime } from '../../src/runtime/contract';
import type { RuntimePluginContext } from '../../src/runtime/loader';
import { RuntimeBus } from '../../src/runtime/runtime-bus';
import { createNeutralRuntime } from '../../src/runtime/neutral-runtime';
import { createPiState, type PiRuntimeDeps } from '../../../adapters/pi/src/runtime';

export type PiTestRuntime = AgentRuntime & { registry: any; eventStream: any };

export async function createPiRuntime(
  ctx: RuntimePluginContext,
  deps: PiRuntimeDeps = {},
): Promise<PiTestRuntime> {
  const state = await createPiState(ctx, deps);
  const bus = new RuntimeBus();
  bus.register(state.definition);
  const runtime = createNeutralRuntime(state.definition, { bus }) as PiTestRuntime;
  runtime.registry = state.registry;
  runtime.eventStream = state.eventStream;
  return runtime;
}
