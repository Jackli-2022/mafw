// gateway/src/session/index.ts
// Barrel + the shared default registry instance.
//
// The default instance is what cross-module views (worker-origin) and the
// gateway wiring use so every view sees one process table. Tests construct
// isolated `new SessionRegistry()` instances instead.

import { SessionRegistry } from './registry';

export type { SessionStatus, SessionRecord, RegisterInput, SessionRegistryOpts } from './registry';
export { SessionRegistry } from './registry';
export type { SessionScope } from './scope';

let defaultInstance: SessionRegistry | null = null;

/** The gateway-wide shared registry (lazy singleton). */
export function getDefaultSessionRegistry(): SessionRegistry {
  if (!defaultInstance) defaultInstance = new SessionRegistry();
  return defaultInstance;
}
