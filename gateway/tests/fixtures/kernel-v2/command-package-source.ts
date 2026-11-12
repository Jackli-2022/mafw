import type { CommandSource } from '../../../src/kernel-v2/providers/commands';
import type { CustomCommandSpec } from '../../../src/commands/custom-commands';

/**
 * Test-package command source. Registered at the package tier by the G2 test;
 * no gateway core file changes are involved.
 */
export function createCommandPackageSource(): CommandSource {
  const spec: CustomCommandSpec = {
    name: 'package:hello',
    description: 'Hello from a package',
    template: 'Say hello from the test package.',
    sourceFile: 'package/hello.md',
  };
  return {
    id: 'package',
    scan: async () => [spec],
  };
}
