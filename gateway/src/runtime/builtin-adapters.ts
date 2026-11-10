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
  opencodeDiscoveryRoots,
  opencodeStaticEntry,
  type OpencodeVariant,
} from './opencode-adapter';

export interface BuiltinAdapterRegistration {
  name: string;
  variant: OpencodeVariant;
  /** Loader options (capabilities/eventEntry are adapter-declared data). */
  options: {
    external: boolean;
    capabilities: RuntimeCapabilities;
    eventEntry: EventMappingEntry;
  };
}

/** First registered builtin adapter is the default runtime. */
export const DEFAULT_BUILTIN_RUNTIME = OPENCODE_REGISTRATIONS[0]?.name ?? 'runtime';

export function builtinAdapterRegistrations(external: boolean): BuiltinAdapterRegistration[] {
  return OPENCODE_REGISTRATIONS.map((registration) => ({
    name: registration.name,
    variant: registration.variant,
    options: {
      external,
      capabilities: opencodeCapabilities(registration.variant, external),
      eventEntry: opencodeStaticEntry(registration.variant),
    },
  }));
}

/** Skill/instruction roots declared by the builtin adapter (no runtime needed). */
export function builtinDiscoveryRoots(): { skillRoots?: string[]; instructionRoots?: string[] } {
  return opencodeDiscoveryRoots();
}
