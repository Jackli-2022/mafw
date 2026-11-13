import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AutomationEngine, AutomationRule } from '../../src/automation-engine';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'automation-events-'));
}

function writeRule(dir: string, rule: AutomationRule): void {
  const automationDir = path.join(dir, 'automations');
  fs.mkdirSync(automationDir, { recursive: true });
  fs.writeFileSync(path.join(automationDir, `${rule.id}.json`), JSON.stringify(rule), 'utf-8');
}

function eventRule(): AutomationRule {
  return {
    id: 'r1',
    enabled: true,
    trigger: {
      type: 'event',
      on: ['plugin:demo:changed'],
      perGoalCooldown: '1h',
    },
    action: { type: 'test' },
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('AutomationEngine external events', () => {
  test('a plugin event triggers matching event rules with per-scope cooldown', async () => {
    const dir = tmpDir();
    writeRule(dir, eventRule());
    const engine = new AutomationEngine(dir);
    let runs = 0;
    engine.setActionsProvider(() => engine.registerAction('test', async () => {
      runs++;
    }));
    engine.loadRules();
    engine.start();

    engine.handleExternalEvent({ type: 'plugin:demo:changed', sessionID: 's1', properties: { value: 1 } });
    engine.handleExternalEvent({ type: 'plugin:demo:changed', sessionID: 's1', properties: { value: 2 } });
    await wait(30);
    expect(runs).toBe(1);

    engine.handleExternalEvent({ type: 'plugin:demo:changed', sessionID: 's2', properties: { value: 3 } });
    await wait(30);
    expect(runs).toBe(2);
  });

  test('unmatched plugin events do nothing', async () => {
    const dir = tmpDir();
    writeRule(dir, eventRule());
    const engine = new AutomationEngine(dir);
    let runs = 0;
    engine.setActionsProvider(() => engine.registerAction('test', async () => {
      runs++;
    }));
    engine.loadRules();
    engine.start();

    engine.handleExternalEvent({ type: 'plugin:other:changed', sessionID: 's1' });
    await wait(30);
    expect(runs).toBe(0);
  });
});
