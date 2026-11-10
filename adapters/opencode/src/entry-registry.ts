/**
 * Tooling registry for dialect entries (dry-event / conformance).
 *
 * Plan 6 kept this map inside `legacy-definition.ts`; Phase 4 W2 needs it from
 * the native definition without importing the legacy bridge. This module owns
 * the map; the legacy bridge re-exports it for the one-release tests/tooling.
 */
import type { EventMappingEntry } from '@mafw/runtime-core';

const entries = new Map<string, EventMappingEntry>();

export function getBridgeEventEntry(name: string): EventMappingEntry | undefined {
  return entries.get(name);
}

export function setBridgeEventEntry(name: string, entry: EventMappingEntry): void {
  entries.set(name, entry);
}
