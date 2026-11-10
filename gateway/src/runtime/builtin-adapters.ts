/**
 * Generic builtin-adapter registration aggregation (Phase 4 W4).
 *
 * Adapter packages export registration descriptors (names + variants); this
 * module turns them into the loader's `{ capabilities, eventEntry }` payload.
 * It is the only gateway file that names opencode besides the package binding,
 * so the composition root has no per-runtime branches.
 */
import type { RuntimeCapabilities } from '@mafw/runtime-contract';
import type { EventMappingEntry } from './event-mapper';
import {
  OPENCODE_REGISTRATIONS,
  opencodeCapabilities,
  opencodeStaticEntry,
  type OpencodeVariant,
} from './opencode-adapter';

export interface BuiltinAdapterRegistration {
  name: string;
  variant: OpencodeVariant;
  capabilities: RuntimeCapabilities;
  eventEntry: EventMappingEntry;
}

export function builtinAdapterRegistrations(external: boolean): BuiltinAdapterRegistration[] {
  return OPENCODE_REGISTRATIONS.map((registration) => ({
    name: registration.name,
    variant: registration.variant,
    capabilities: opencodeCapabilities(registration.variant, external),
    eventEntry: opencodeStaticEntry(registration.variant),
  }));
}
