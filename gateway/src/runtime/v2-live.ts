/**
 * Phase 3.5 live bridge.
 *
 * This is the **only** live module allowed to import `kernel-v2/**`.
 * Both insertion points are live by default; the env vars are kill switches:
 *
 *   MAFW_KERNEL_V2_OBSERVERS=0|false   turn canonical observers off
 *   MAFW_KERNEL_V2_TOOLS=0|false       turn plugin tool merge off
 *
 * With both planes killed the bridge is `null` and v1 behavior is unchanged.
 */

import { CanonicalObserverRegistry } from '../kernel-v2/observer';
import { toCanonicalEvent, type EventFacetLike } from '../kernel-v2/canonical-event';
import {
  createToolContributionRegistry,
  type ToolContribution,
} from '../kernel-v2/tools';
import type { CanonicalObserver } from '../kernel-v2/observer';
import type { PluginObserverEntry, PluginToolEntry } from '../plugins/package-types';
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
  /** Phase 3.6: reconcile package tools/observers by revision. */
  syncPluginContributions(tools: PluginToolEntry[], observers: PluginObserverEntry[]): void;
  drain(): Promise<void>;
  dispose(): Promise<void>;
}

export interface KernelV2LiveOptions {
  env?: NodeJS.ProcessEnv;
  log?: { info(message: string): void; warn(message: string): void };
}

/** Phase 3 flags shipped; they are now kill switches, not opt-ins. */
function disabled(value: string | undefined): boolean {
  return value === '0' || value === 'false';
}

export function readKernelV2LiveFlags(env: NodeJS.ProcessEnv = process.env): KernelV2LiveFlags {
  return {
    observers: !disabled(env.MAFW_KERNEL_V2_OBSERVERS),
    tools: !disabled(env.MAFW_KERNEL_V2_TOOLS),
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeToolResult(value: unknown): { text: string; isError?: boolean } {
  if (typeof value === 'string') return { text: value };
  if (value && typeof value === 'object') {
    const record = value as { text?: unknown; isError?: unknown };
    if (typeof record.text === 'string') {
      return {
        text: record.text,
        ...(record.isError === true ? { isError: true } : {}),
      };
    }
  }
  try {
    const json = JSON.stringify(value);
    return { text: json ?? String(value) };
  } catch {
    return { text: String(value) };
  }
}

function toToolContribution(entry: PluginToolEntry): ToolContribution {
  return {
    packageName: entry.packageName,
    name: entry.name,
    ...(entry.title ? { title: entry.title } : {}),
    description: entry.description,
    parameters: entry.inputSchema as Record<string, any>,
    ...(entry.outputSchema
      ? { outputSchema: entry.outputSchema as Record<string, any> }
      : {}),
    ...(entry.timeoutMs !== undefined ? { timeoutMs: entry.timeoutMs } : {}),
    scope: 'global',
    execute: async (input, ctx) =>
      normalizeToolResult(
        await entry.handler(input, {
          sessionID: ctx.sessionID,
          signal: ctx.signal ?? new AbortController().signal,
        }),
      ),
  };
}

function toObserver(entry: PluginObserverEntry): CanonicalObserver {
  return {
    id: `plugin:${entry.packageName}:${entry.id}`,
    ...(entry.filter ? { filter: entry.filter } : {}),
    ...(entry.timeoutMs !== undefined ? { timeoutMs: entry.timeoutMs } : {}),
    onEvent: (event) => entry.onEvent(event),
  };
}

export function createKernelV2Live(
  options: KernelV2LiveOptions = {},
): KernelV2Live | null {
  const flags = readKernelV2LiveFlags(options.env ?? process.env);
  if (!flags.observers && !flags.tools) return null;

  const observers = flags.observers ? new CanonicalObserverRegistry() : null;
  const tools = flags.tools ? createToolContributionRegistry() : null;
  const toolRegistrations = new Map<string, { revision: string; unregister: () => void }>();
  const observerRegistrations = new Map<string, { revision: string; unregister: () => void }>();
  let disposed = false;

  function syncTools(entries: PluginToolEntry[]): void {
    if (!tools) return;
    const next = new Set(entries.map((entry) => `${entry.packageName}:${entry.name}`));
    for (const [key, current] of toolRegistrations) {
      if (next.has(key)) continue;
      current.unregister();
      toolRegistrations.delete(key);
    }
    for (const entry of entries) {
      const key = `${entry.packageName}:${entry.name}`;
      const current = toolRegistrations.get(key);
      if (current?.revision === entry.revision) continue;
      current?.unregister();
      try {
        const unregister = tools.register(toToolContribution(entry));
        toolRegistrations.set(key, { revision: entry.revision, unregister });
      } catch (error) {
        options.log?.warn(
          `[kernel-v2] plugin tool registration failed for ${key}: ${messageOf(error)}`,
        );
      }
    }
  }

  function syncObservers(entries: PluginObserverEntry[]): void {
    if (!observers) return;
    const next = new Set(entries.map((entry) => `${entry.packageName}:${entry.id}`));
    for (const [key, current] of observerRegistrations) {
      if (next.has(key)) continue;
      current.unregister();
      observerRegistrations.delete(key);
    }
    for (const entry of entries) {
      const key = `${entry.packageName}:${entry.id}`;
      const current = observerRegistrations.get(key);
      if (current?.revision === entry.revision) continue;
      current?.unregister();
      try {
        const unregister = observers.register(toObserver(entry));
        observerRegistrations.set(key, { revision: entry.revision, unregister });
      } catch (error) {
        options.log?.warn(
          `[kernel-v2] plugin observer registration failed for ${key}: ${messageOf(error)}`,
        );
      }
    }
  }

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
      if (disposed) throw new Error('kernel-v2 live bridge is disposed');
      if (!observers) {
        throw new Error(
          'kernel-v2 observers are disabled (MAFW_KERNEL_V2_OBSERVERS=0)',
        );
      }
      return observers.register(observer);
    },

    toolFactory(): ((sessionID: string) => MafwToolRegistration[]) | undefined {
      return tools?.factory();
    },

    registerTool(tool: ToolContribution): () => void {
      if (disposed) throw new Error('kernel-v2 live bridge is disposed');
      if (!tools) {
        throw new Error('kernel-v2 tools are disabled (MAFW_KERNEL_V2_TOOLS=0)');
      }
      return tools.register(tool);
    },

    syncPluginContributions(
      toolEntries: PluginToolEntry[],
      observerEntries: PluginObserverEntry[],
    ): void {
      if (disposed) return;
      syncTools(toolEntries);
      syncObservers(observerEntries);
    },

    async drain(): Promise<void> {
      await observers?.drain();
    },

    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      for (const current of toolRegistrations.values()) {
        try {
          current.unregister();
        } catch {
          /* teardown is fail-open */
        }
      }
      toolRegistrations.clear();
      for (const current of observerRegistrations.values()) {
        try {
          current.unregister();
        } catch {
          /* teardown is fail-open */
        }
      }
      observerRegistrations.clear();
      await Promise.allSettled([observers?.dispose(), tools?.dispose()]);
    },
  };
}
