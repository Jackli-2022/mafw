import { CapabilityRegistry } from '../../../src/kernel-v2/capability-registry';
import {
  createCommandCapability,
  registerCommandSource,
  type CommandSource,
} from '../../../src/kernel-v2/providers/commands';
import type { CustomCommandSpec } from '../../../src/commands/custom-commands';
import { createCommandPackageSource } from '../../fixtures/kernel-v2/command-package-source';
import { runCommandsConformance } from '../../helpers/kernel-v2/commands-conformance';

const spec = (name: string, template = name): CustomCommandSpec => ({
  name,
  description: name,
  template,
  sourceFile: `${name}.md`,
});

function source(
  id: string,
  specs: CustomCommandSpec[],
  disposedOrder?: string[],
): CommandSource {
  return {
    id,
    scan: async () => specs,
    ...(disposedOrder
      ? {
          dispose: async () => {
            disposedOrder.push(id);
          },
        }
      : {}),
  };
}

function registry(): CapabilityRegistry<CommandSource> {
  return new CapabilityRegistry<CommandSource>({
    defaultId: 'builtin',
    capability: 'commands',
    version: '1.0.0',
    revision: 'kit',
    plane: 'gateway',
  });
}

runCommandsConformance('command source', {
  create() {
    const disposedOrder: string[] = [];
    return {
      registry: registry(),
      builtin: source('builtin', [spec('help', 'builtin')], disposedOrder),
      legacy: source('legacy', [spec('help', 'legacy'), spec('ship', 'ship')], disposedOrder),
      packageOverride: source(
        'package',
        [spec('ship', 'package'), spec('deploy', 'deploy')],
        disposedOrder,
      ),
      bad: {
        id: 'bad',
        scan: async () => {
          throw new Error('boom');
        },
      },
      project: source('project', [spec('project-only')]),
      disposedOrder,
      projectScope: { kind: 'project', projectId: 'p1' },
    };
  },
});

test('test package source is additive without core edits', async () => {
  const reg = registry();
  registerCommandSource(reg, source('builtin', [spec('help')]));
  registerCommandSource(reg, createCommandPackageSource(), 'package');
  const commands = await createCommandCapability(reg).list();
  expect(commands.map((item) => item.name)).toEqual(['help', 'package:hello']);
});
