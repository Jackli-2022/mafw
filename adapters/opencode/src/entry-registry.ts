/**
 * Tooling registry for dialect entries (dry-event / conformance).
 *
 * The legacy bridge kept this map internally in Plan 6; Phase 4 moved it here so
 * the native definition can use it without importing the legacy bridge.
 */
import type { EventMappingEntry } from '@mafw/runtime-core';

const entries = new Map<string, EventMappingEntry>();

export function getBridgeEventEntry(name: string): EventMappingEntry | undefined {
  return entries.get(name);
}

export function setBridgeEventEntry(name: string, entry: EventMappingEntry): void {
  entries.set(name, entry);
}
