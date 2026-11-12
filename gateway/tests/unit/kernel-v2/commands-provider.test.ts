import { CapabilityRegistry } from '../../../src/kernel-v2/capability-registry';
import {
  createCommandCapability,
  registerCommandSource,
  type CommandSource,
} from '../../../src/kernel-v2/providers/commands';
import type { CustomCommandSpec } from '../../../src/commands/custom-commands';

const spec = (name: string, template = name): CustomCommandSpec => ({
  name,
  description: name,
  template,
  sourceFile: `${name}.md`,
});

const source = (
  id: string,
  specs: CustomCommandSpec[],
  over: Partial<CommandSource> = {},
): CommandSource => ({ id, scan: async () => specs, ...over });

function registry() {
  return new CapabilityRegistry<CommandSource>({
    defaultId: 'builtin',
    capability: 'commands',
    version: '1.0.0',
    revision: 'test',
    plane: 'gateway',
  });
}

describe('Command capability adapter', () => {
  test('merges builtin -> legacy -> package with later tiers overriding names', async () => {
    const reg = registry();
    registerCommandSource(reg, source('builtin', [spec('help', 'builtin')]));
    registerCommandSource(reg, source('user', [spec('help', 'user'), spec('ship')]), 'legacy');
    registerCommandSource(reg, source('pkg', [spec('ship', 'package')]), 'package');
    const commands = createCommandCapability(reg);
    expect((await commands.list()).map((c) => [c.name, c.template])).toEqual([
      ['help', 'user'],
      ['ship', 'package'],
    ]);
  });

  test('a failing source is skipped without erasing other commands', async () => {
    const reg = registry();
    registerCommandSource(
      reg,
      source('bad', [], {
        scan: async () => {
          throw new Error('boom');
        },
      }),
    );
    registerCommandSource(reg, source('good', [spec('ok')]), 'legacy');
    expect((await createCommandCapability(reg).list()).map((c) => c.name)).toEqual(['ok']);
  });

  test('dispose calls each source dispose in reverse order and isolates errors', async () => {
    const order: string[] = [];
    const reg = registry();
    registerCommandSource(
      reg,
      source('a', [], {
        dispose: async () => {
          order.push('a');
        },
      }),
    );
    registerCommandSource(
      reg,
      source('b', [], {
        dispose: async () => {
          order.push('b');
          throw new Error('x');
        },
      }),
    );
    const commands = createCommandCapability(reg);
    await expect(commands.dispose()).resolves.toBeUndefined();
    expect(order).toEqual(['b', 'a']);
    await expect(commands.dispose()).resolves.toBeUndefined();
    expect((await commands.list()).length).toBe(0);
  });

  test('scope isolation: project source is not visible globally', async () => {
    const reg = registry();
    const project = { kind: 'project', projectId: 'p1' } as const;
    registerCommandSource(reg, source('a', [spec('global')]));
    registerCommandSource(reg, source('p', [spec('project')]), 'package', project);
    const commands = createCommandCapability(reg);
    expect((await commands.list()).map((c) => c.name)).toEqual(['global']);
    expect((await commands.list(project)).map((c) => c.name)).toEqual(['global', 'project']);
  });

  test('sources() lists visible source ids and tiers', () => {
    const reg = registry();
    registerCommandSource(reg, source('a', []));
    registerCommandSource(reg, source('b', []), 'package');
    expect(createCommandCapability(reg).sources()).toEqual([
      { id: 'a', tier: 'builtin' },
      { id: 'b', tier: 'package' },
    ]);
  });
});
