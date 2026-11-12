import { CapabilityRegistry } from '../../../src/kernel-v2/capability-registry';
import {
  createAutomationCapability,
  registerAutomationAction,
  type AutomationActionProvider,
} from '../../../src/kernel-v2/providers/automation';

const action = (
  id: string,
  over: Partial<AutomationActionProvider> = {},
): AutomationActionProvider => ({ id, handler: async () => id, ...over });

function registry() {
  return new CapabilityRegistry<AutomationActionProvider>({
    defaultId: 'echo',
    capability: 'automation-action',
    version: '1.0.0',
    revision: 'test',
    plane: 'gateway',
  });
}

describe('Automation action capability', () => {
  test('resolves default and package override', () => {
    const reg = registry();
    registerAutomationAction(reg, action('echo'));
    registerAutomationAction(reg, action('echo'), 'package');
    const automation = createAutomationCapability(reg);
    expect(automation.resolve('echo').id).toBe('echo');
    expect(automation.actions()[0].tier).toBe('package');
  });

  test('unknown action fails closed instead of throwing', async () => {
    const reg = registry();
    await expect(
      createAutomationCapability(reg).run('missing', { ruleId: 'r1' }),
    ).resolves.toMatchObject({ ok: false, error: 'missing' });
  });

  test('handler error is isolated and reported', async () => {
    const reg = registry();
    registerAutomationAction(
      reg,
      action('bad', {
        handler: async () => {
          throw new Error('boom');
        },
      }),
    );
    await expect(
      createAutomationCapability(reg).run('bad', { ruleId: 'r1' }),
    ).resolves.toEqual({ ok: false, error: 'failed', message: 'boom' });
  });

  test('unhealthy action fails closed with a reason', async () => {
    const reg = registry();
    registerAutomationAction(reg, action('sick', { health: () => 'failed' }));
    await expect(
      createAutomationCapability(reg).run('sick', { ruleId: 'r1' }),
    ).resolves.toEqual({
      ok: false,
      error: 'failed',
      message: 'automation action is unhealthy: sick',
    });
  });

  test('success returns the handler value', async () => {
    const reg = registry();
    registerAutomationAction(
      reg,
      action('echo', { handler: async (input) => ({ ruleId: input.ruleId }) }),
    );
    await expect(
      createAutomationCapability(reg).run('echo', { ruleId: 'r9' }),
    ).resolves.toEqual({ ok: true, value: { ruleId: 'r9' } });
  });

  test('dispose unregisters and calls provider dispose once', async () => {
    let disposals = 0;
    const reg = registry();
    registerAutomationAction(
      reg,
      action('echo', {
        dispose: async () => {
          disposals += 1;
        },
      }),
    );
    await reg.dispose();
    expect(disposals).toBe(1);
  });
});
