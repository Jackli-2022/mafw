import { AutomationEngine, actionRegistry, ActionHandler, AutomationRule } from '../../gateway/src/automation-engine';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('AutomationEngine actionRegistry', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-ae-test-'));
  });
  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('has 4 memory actions registered', () => {
    expect(actionRegistry.has('memory:distill')).toBe(true);
    expect(actionRegistry.has('memory:decay')).toBe(true);
    expect(actionRegistry.has('memory:review')).toBe(true);
    expect(actionRegistry.has('memory:prune')).toBe(true);
  });

  it('executes handler without error for memory:distill', async () => {
    const handler = actionRegistry.get('memory:distill')!;
    const engine = new AutomationEngine(tmpDir);
    // should not throw
    await handler({ id: 'test', enabled: true, trigger: { type: 'cron', schedule: '* * * * *', timezone: 'UTC' } }, engine);
  });

  it('validateRule accepts registered action types', () => {
    const engine = new AutomationEngine(tmpDir);
    const result = engine.validateRule({
      id: 'test', enabled: false,
      trigger: { type: 'cron', schedule: '0 0 * * *', timezone: 'UTC' },
      action: { type: 'memory:distill' },
    });
    expect(result.valid).toBe(true);
  });

  it('validateRule rejects unregistered action types', () => {
    const engine = new AutomationEngine(tmpDir);
    const result = engine.validateRule({
      id: 'test', enabled: false,
      trigger: { type: 'cron', schedule: '0 0 * * *', timezone: 'UTC' },
      action: { type: 'manager:report_completed' },
    });
    // manager:* not yet registered — should fail validation
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Unknown action type'))).toBe(true);
  });

  it('executeRule logs warning for unregistered action', async () => {
    const engine = new AutomationEngine(tmpDir);
    const warnSpy = jest.spyOn(require('../../gateway/src/core/utils/logger').log, 'warn').mockImplementation();
    engine['rules'].set('bad', {
      id: 'bad', enabled: true,
      trigger: { type: 'cron', schedule: '* * * * *', timezone: 'UTC' },
      action: { type: 'nonexistent:action' },
    });
    await engine.executeRule('bad');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('No handler registered'));
    warnSpy.mockRestore();
  });
});
