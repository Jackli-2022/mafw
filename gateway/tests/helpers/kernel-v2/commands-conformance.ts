/**
 * Command source conformance kit.
 *
 * The factory supplies a standard set of sources; the kit registers them and
 * asserts merge order, fail-open behavior, scope isolation and LIFO dispose.
 */

import type { CapabilityRegistry } from '../../../src/kernel-v2/capability-registry';
import {
  createCommandCapability,
  registerCommandSource,
  type CommandSource,
} from '../../../src/kernel-v2/providers/commands';

export interface CommandsConformanceFactory {
  create(): {
    registry: CapabilityRegistry<CommandSource>;
    builtin: CommandSource;
    legacy: CommandSource;
    packageOverride: CommandSource;
    bad: CommandSource;
    project: CommandSource;
    disposedOrder: string[];
    projectScope: { kind: 'project'; projectId: string };
  };
}

export function runCommandsConformance(
  name: string,
  factory: CommandsConformanceFactory,
): void {
  describe(`${name} conformance`, () => {
    test('merges tiers in order and skips a failing source', async () => {
      const fixture = factory.create();
      registerCommandSource(fixture.registry, fixture.builtin);
      registerCommandSource(fixture.registry, fixture.legacy, 'legacy');
      registerCommandSource(fixture.registry, fixture.packageOverride, 'package');
      registerCommandSource(fixture.registry, fixture.bad, 'package');
      const commands = await createCommandCapability(fixture.registry).list();
      expect(commands.map((item) => [item.name, item.template])).toEqual([
        ['help', 'legacy'],
        ['ship', 'package'],
        ['deploy', 'deploy'],
      ]);
    });

    test('project source is visible only inside the project scope', async () => {
      const fixture = factory.create();
      registerCommandSource(fixture.registry, fixture.builtin);
      registerCommandSource(
        fixture.registry,
        fixture.project,
        'package',
        fixture.projectScope,
      );
      const capability = createCommandCapability(fixture.registry);
      expect((await capability.list()).map((item) => item.name)).not.toContain('project-only');
      expect((await capability.list(fixture.projectScope)).map((item) => item.name)).toContain(
        'project-only',
      );
    });

    test('dispose is LIFO and idempotent', async () => {
      const fixture = factory.create();
      registerCommandSource(fixture.registry, fixture.builtin);
      registerCommandSource(fixture.registry, fixture.legacy, 'legacy');
      registerCommandSource(fixture.registry, fixture.packageOverride, 'package');
      const capability = createCommandCapability(fixture.registry);
      await capability.dispose();
      expect(fixture.disposedOrder).toEqual(['package', 'legacy', 'builtin']);
      await capability.dispose();
      expect(fixture.disposedOrder).toEqual(['package', 'legacy', 'builtin']);
    });
  });
}
