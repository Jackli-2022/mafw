import { createToolContributionRegistry } from '../../../src/kernel-v2/tools';
import { createPluginToolEcho } from '../../fixtures/kernel-v2/plugin-tool-echo';
import { runToolsConformance } from '../../helpers/kernel-v2/tools-conformance';

runToolsConformance('tool registry', {
  create: () => createToolContributionRegistry({ defaultTimeoutMs: 20 }),
});

test('test package tool is callable without core edits', async () => {
  const registry = createToolContributionRegistry();
  registry.register(createPluginToolEcho());
  await expect(
    registry.invoke('plugin:demo:echo', { text: 'hi' }, { sessionID: 's1' }),
  ).resolves.toEqual({ text: 'echo:hi' });
});
