/**
 * Phase 3.5 live bridge.
 *
 * This is the **only** live module allowed to import `kernel-v2/**`.
 * Everything is opt-in:
 *
 *   MAFW_KERNEL_V2_OBSERVERS=1   canonical observers on the event pipeline
 *   MAFW_KERNEL_V2_TOOLS=1       plugin tools merged into runtime registration
 *
 * With both flags off the bridge is `null` and v1 behavior is unchanged.
 */

import { CanonicalObserverRegistry } from '../kernel-v2/observer';
import { toCanonicalEvent, type EventFacetLike } from '../kernel-v2/canonical-event';
import {
  createToolContributionRegistry,
  type ToolContribution,
} from '../kernel-v2/tools';
import type { CanonicalObserver } from '../kernel-v2/observer';
import type { MafwToolRegistration } from './contract';

export type { CanonicalEvent, CanonicalObserver } from '../kernel-v2/observer';
export type { ToolContribution } from '../kernel-v2/tools';

export interface KernelV2LiveFlags {
  observers: boolean;
  tools: boolean;
}

export interface KernelV2Live {
  readonly observersEnabled: boolean;
  readonly toolsEnabled: boolean;
  observe(facets: EventFacetLike): void;
  registerObserver(observer: CanonicalObserver): () => void;
  toolFactory(): ((sessionID: string) => MafwToolRegistration[]) | undefined;
  registerTool(tool: ToolContribution): () => void;
  drain(): Promise<void>;
  dispose(): Promise<void>;
}

export interface KernelV2LiveOptions {
  env?: NodeJS.ProcessEnv;
  log?: { info(message: string): void; warn(message: string): void };
}

function enabled(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

export function readKernelV2LiveFlags(env: NodeJS.ProcessEnv = process.env): KernelV2LiveFlags {
  return {
    observers: enabled(env.MAFW_KERNEL_V2_OBSERVERS),
    tools: enabled(env.MAFW_KERNEL_V2_TOOLS),
  };
}

export function createKernelV2Live(
  options: KernelV2LiveOptions = {},
): KernelV2Live | null {
  const flags = readKernelV2LiveFlags(options.env ?? process.env);
  if (!flags.observers && !flags.tools) return null;

  const observers = flags.observers ? new CanonicalObserverRegistry() : null;
  const tools = flags.tools ? createToolContributionRegistry() : null;

  options.log?.info(
    `[kernel-v2] live wiring enabled (observers=${flags.observers}, tools=${flags.tools})`,
  );

  return {
    observersEnabled: flags.observers,
    toolsEnabled: flags.tools,

    observe(facets: EventFacetLike): void {
      if (!observers) return;
      try {
        observers.dispatch(toCanonicalEvent(facets));
      } catch {
        /* observer ingress is fail-open */
      }
    },

    registerObserver(observer: CanonicalObserver): () => void {
      if (!observers) {
        throw new Error(
          'kernel-v2 observers are disabled (set MAFW_KERNEL_V2_OBSERVERS=1)',
        );
      }
      return observers.register(observer);
    },

    toolFactory(): ((sessionID: string) => MafwToolRegistration[]) | undefined {
      return tools?.factory();
    },

    registerTool(tool: ToolContribution): () => void {
      if (!tools) {
        throw new Error('kernel-v2 tools are disabled (set MAFW_KERNEL_V2_TOOLS=1)');
      }
      return tools.register(tool);
    },

    async drain(): Promise<void> {
      await observers?.drain();
    },

    async dispose(): Promise<void> {
      await Promise.allSettled([observers?.dispose(), tools?.dispose()]);
    },
  };
}
