import type { RuntimeDefinition } from '@mafw/runtime-contract';

export type PluginEntry =
  | { kind: 'neutral'; definition: RuntimeDefinition }
  | { kind: 'factory'; factory: (ctx: any) => Promise<RuntimeDefinition> }
  | { kind: 'legacy'; runtime: any };

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object';
}

export function resolvePluginEntry(exported: unknown): PluginEntry | null {
  if (!isRecord(exported)) return null;
  if (exported.api === 1 && isRecord(exported.transport)) {
    return { kind: 'neutral', definition: exported as RuntimeDefinition };
  }
  if (typeof exported.createRuntimeDefinition === 'function') {
    return { kind: 'factory', factory: exported.createRuntimeDefinition };
  }
  if (typeof exported.createRuntime === 'function') {
    return { kind: 'legacy', runtime: exported };
  }
  return null;
}
