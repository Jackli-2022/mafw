import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AutomationEngine, AutomationRule } from '../../src/automation-engine';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'automation-ext-'));
}

function rule(action: string): AutomationRule {
  return {
    id: 'r1',
    enabled: true,
    trigger: { type: 'cron', schedule: '0 * * * *', timezone: 'UTC' },
    action: { type: action },
  };
}

describe('AutomationEngine external actions', () => {
  test('local action wins over the external resolver', async () => {
    const engine = new AutomationEngine(tmpDir());
    const calls: string[] = [];
    engine.setActionsProvider(() => {
      engine.registerAction('same', async () => {
        calls.push('local');
      });
    });
    engine.setExternalActionResolver(() => ({
      handler: async () => {
        calls.push('external');
      },
    }));
    engine.start();

    const status = await (engine as any).executeAction('same', rule('same'), 'user');
    expect(status).toBe('ran');
    expect(calls).toEqual(['local']);
  });

  test('external action runs when no local handler exists', async () => {
    const engine = new AutomationEngine(tmpDir());
    const seen: Array<{ id: string; source?: string }> = [];
    engine.setExternalActionResolver((type) =>
      type === 'plugin:p:a'
        ? {
            handler: async (r, _engine, source) => {
              seen.push({ id: r.id, source });
            },
          }
        : undefined,
    );

    const status = await (engine as any).executeAction('plugin:p:a', rule('plugin:p:a'), 'event');
    expect(status).toBe('ran');
    expect(seen).toEqual([{ id: 'r1', source: 'event' }]);
  });

  test('missing external action returns missing', async () => {
    const engine = new AutomationEngine(tmpDir());
    expect(await (engine as any).executeAction('missing', rule('missing'), 'cron')).toBe('missing');
  });

  test('throwing external action returns error without escaping', async () => {
    const engine = new AutomationEngine(tmpDir());
    engine.setExternalActionResolver(() => ({
      handler: async () => {
        throw new Error('boom');
      },
    }));
    expect(await (engine as any).executeAction('boom', rule('boom'), 'cron')).toBe('error');
  });

  test('validateRule accepts a plugin action only when the resolver can see it', () => {
    const engine = new AutomationEngine(tmpDir());
    const pluginRule: AutomationRule = {
      id: 'plugin-rule',
      enabled: true,
      trigger: { type: 'cron', schedule: '0 * * * *', timezone: 'UTC' },
      action: { type: 'plugin:p:a' },
    };
    expect(engine.validateRule(pluginRule).valid).toBe(false);
    engine.setExternalActionResolver((type) =>
      type === 'plugin:p:a' ? { handler: async () => {} } : undefined,
    );
    expect(engine.validateRule(pluginRule).valid).toBe(true);
  });

  test('canResolveAction sees both local and external handlers', () => {
    const engine = new AutomationEngine(tmpDir());
    engine.setActionsProvider(() => engine.registerAction('local', async () => {}));
    engine.start();
    engine.setExternalActionResolver((type) => (type === 'plugin:p:a' ? { handler: async () => {} } : undefined));

    expect(engine.canResolveAction('local')).toBe(true);
    expect(engine.canResolveAction('plugin:p:a')).toBe(true);
    expect(engine.canResolveAction('missing')).toBe(false);
  });
});
