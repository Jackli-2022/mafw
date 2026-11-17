/**
 * Process-local check host for `mafw plugin check`.
 *
 * The check must work with the gateway stopped and without a human token, so it
 * never talks HTTP: it builds one real `PluginHost` lazily and runs
 * `checkPackage()` (a dry-run activation through the same judgement function a
 * real install uses). Nothing is scanned, watched or published.
 *
 * The host is reused across calls in one process (the CLI checks one package per
 * invocation, but keeping the factory lazy makes repeated checks cheap and lets
 * tests exercise it if needed). `checkPackage` disposes its own bag, so there is
 * nothing to release on exit except the scratch directory.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PluginHost, type PluginCheckResult } from '../plugins/package-host';
import { createPluginPackageContext } from '../plugins/package-context';

export function createLocalCheck(): (absolutePath: string) => Promise<PluginCheckResult> {
  let host: PluginHost | undefined;
  return async (absolutePath) => {
    if (!host) {
      // `checkPackage` works on the given directory; this root is never scanned
      // or watched (init() is never called), it only satisfies the constructor.
      const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-check-'));
      process.once('exit', () => {
        try {
          fs.rmSync(scratchRoot, { recursive: true, force: true });
        } catch { /* best effort: a leftover temp dir must not fail the CLI */ }
      });
      host = new PluginHost(
        scratchRoot,
        (pkg, bag) => createPluginPackageContext(pkg, {
          projectDir: process.cwd(),
          gatewayPort: 3000,
          bag,
        }),
      );
    }
    return host.checkPackage(absolutePath);
  };
}
