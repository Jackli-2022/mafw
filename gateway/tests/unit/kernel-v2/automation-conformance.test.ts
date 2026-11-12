import { CapabilityRegistry } from '../../../src/kernel-v2/capability-registry';
import {
  createAutomationCapability,
  registerAutomationAction,
  type AutomationActionProvider,
} from '../../../src/kernel-v2/providers/automation';
import { createAutomationEchoAction } from '../../fixtures/kernel-v2/automation-echo-action';
import { runAutomationConformance } from '../../helpers/kernel-v2/automation-conformance';

function action(
  id: string,
  over: Partial<AutomationActionProvider> = {},
): AutomationActionProvider {
  return { id, handler: async () => id, ...over };
}

function registry(): CapabilityRegistry<AutomationActionProvider> {
  return new CapabilityRegistry<AutomationActionProvider>({
    defaultId: 'echo',
    capability: 'automation-action',
    version: '1.0.0',
    revision: 'kit',
    plane: 'gateway',
  });
}

runAutomationConformance('automation action', {
  create() {
    return {
      registry: registry(),
      echo: action('echo', { handler: async (input) => ({ echoed: input.ruleId }) }),
      failing: action('failing', {
        handler: async () => {
          throw new Error('boom');
        },
      }),
      unhealthy: action('unhealthy', { health: () => 'failed' }),
    };
  },
});

test('test package action is additive without core edits', async () => {
  const reg = registry();
  registerAutomationAction(reg, action('echo'));
  registerAutomationAction(reg, createAutomationEchoAction(), 'package');
  await expect(
    createAutomationCapability(reg).run('echo-action', { ruleId: 'r7' }),
  ).resolves.toEqual({ ok: true, value: { echoed: 'r7' } });
});
