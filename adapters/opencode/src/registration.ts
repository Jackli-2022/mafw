/**
 * Adapter-owned registration descriptors (Phase 4 W4).
 *
 * The gateway's composition root loops over these instead of hardcoding the
 * four opencode names. `variant` selects the dialect; `name` is the loader key
 * (`opencode`, `opencode@v1`, ...). Capabilities/entry are resolved by the
 * gateway through the adapter exports because they depend on `external` mode.
 */
import type { OpencodeVariant } from './definition';

export interface OpencodeRegistrationDescriptor {
  name: string;
  variant: OpencodeVariant;
}

export const OPENCODE_REGISTRATIONS: readonly OpencodeRegistrationDescriptor[] = [
  { name: 'opencode', variant: 'adaptive' },
  { name: 'opencode@v1', variant: 'v1' },
  { name: 'opencode@v2', variant: 'v2' },
  { name: 'opencode@v21', variant: 'v21' },
];
