/**
 * Adapter-owned discovery roots (Phase 4 W4).
 *
 * The gateway must not hardcode `~/.config/opencode`; it asks the active
 * runtime's discovery channel for these directories instead.
 */
import * as os from 'os';
import * as path from 'path';
import type { RuntimeDiscoveryRoots } from '@mafw/runtime-contract';

export function opencodeDiscoveryRoots(): RuntimeDiscoveryRoots {
  const configDir = path.join(os.homedir(), '.config', 'opencode');
  return {
    skillRoots: [path.join(configDir, 'skills')],
    instructionRoots: [configDir],
  };
}
