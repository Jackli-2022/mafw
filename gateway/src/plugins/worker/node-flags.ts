/**
 * Node permission-model flag detection.
 *
 * Node 22/23 expose `--experimental-permission`; Node 24+ renamed it to
 * `--permission`. The worker host probes once per binary and refuses to run
 * untrusted code when neither flag works — it never falls back to an
 * unconfined in-process load.
 */
import { spawnSync } from 'child_process';

export type PermissionFlag = '--permission' | '--experimental-permission';

const cache = new Map<string, PermissionFlag | null>();
const CANDIDATES: PermissionFlag[] = ['--permission', '--experimental-permission'];

export function permissionFlagFor(nodePath: string): PermissionFlag | null {
  if (cache.has(nodePath)) return cache.get(nodePath) ?? null;
  for (const flag of CANDIDATES) {
    try {
      const result = spawnSync(nodePath, [flag, '-e', '0'], {
        timeout: 2000,
        stdio: 'ignore',
        windowsHide: true,
      });
      if (result.status === 0) {
        cache.set(nodePath, flag);
        return flag;
      }
    } catch {
      // Try the next spelling.
    }
  }
  cache.set(nodePath, null);
  return null;
}
