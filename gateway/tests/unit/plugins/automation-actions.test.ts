import {
  createPluginAutomationActionResolver,
  pluginAutomationActionType,
} from '../../../src/plugins/automation-actions';

describe('plugin automation actions', () => {
  test('maps plugin actions to the namespaced type and passes rule metadata', async () => {
    const calls: unknown[] = [];
    const resolver = createPluginAutomationActionResolver({
      has: (pkg, action) => pkg === 'demo' && action === 'refresh',
      invoke: async (pkg, action, input) => {
        calls.push([pkg, action, input]);
      },
    });

    const entry = resolver(pluginAutomationActionType('demo', 'refresh'));
    expect(entry).toBeTruthy();
    await entry!.handler(
      { id: 'r1', args: { region: 'cn' } } as any,
      {} as any,
      'event',
    );
    expect(calls).toEqual([
      ['demo', 'refresh', { region: 'cn', ruleId: 'r1', source: 'event' }],
    ]);
  });

  test('unknown packages/actions and non-plugin types do not resolve', () => {
    const resolver = createPluginAutomationActionResolver({
      has: () => false,
      invoke: async () => null,
    });
    expect(resolver('plugin:demo:refresh')).toBeUndefined();
    expect(resolver('demo:refresh')).toBeUndefined();
    expect(resolver('plugin:demo')).toBeUndefined();
  });

  test('metadata wins over colliding rule args', async () => {
    const calls: unknown[] = [];
    const resolver = createPluginAutomationActionResolver({
      has: () => true,
      invoke: async (_pkg, _action, input) => {
        calls.push(input);
      },
    });
    await resolver('plugin:demo:refresh')!.handler(
      { id: 'r1', args: { ruleId: 'spoofed', source: 'cron' } } as any,
      {} as any,
      'user',
    );
    expect(calls).toEqual([{ ruleId: 'r1', source: 'user' }]);
  });
});
