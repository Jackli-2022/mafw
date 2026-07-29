import { AutomationEngine, CronTrigger, EventTrigger, Trigger, AutomationRule } from '../../gateway/src/automation-engine';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('AutomationEngine trigger types', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-ae-test-'));
  });
  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  describe('CronTrigger and EventTrigger types', () => {
    it('CronTrigger has correct shape', () => {
      const ct: CronTrigger = { type: 'cron', schedule: '0 0 * * *', timezone: 'UTC' };
      expect(ct.type).toBe('cron');
      expect(ct.schedule).toBe('0 0 * * *');
      expect(ct.timezone).toBe('UTC');
    });

    it('EventTrigger has correct shape', () => {
      const et: EventTrigger = { type: 'event', on: ['goal:completed'], perGoalCooldown: '60s' };
      expect(et.type).toBe('event');
      expect(et.on).toEqual(['goal:completed']);
      expect(et.perGoalCooldown).toBe('60s');
    });

    it('Trigger union accepts both types', () => {
      const cronTrigger: Trigger = { type: 'cron', schedule: '* * * * *', timezone: 'UTC' };
      const eventTrigger: Trigger = { type: 'event', on: ['session:start'], perGoalCooldown: '5m' };
      expect(cronTrigger.type).toBe('cron');
      expect(eventTrigger.type).toBe('event');
    });
  });

  describe('AutomationRule with event triggers', () => {
    it('accepts event trigger in AutomationRule', () => {
      const rule: AutomationRule = {
        id: 'event-test', enabled: true,
        trigger: { type: 'event', on: ['goal:completed'], perGoalCooldown: '60s' },
        action: { type: 'memory:distill' },
      };
      expect(rule.trigger.type).toBe('event');
    });
  });

  describe('validateRule with event triggers', () => {
    it('accepts valid event trigger', () => {
      const engine = new AutomationEngine(tmpDir);
      const result = engine.validateRule({
        id: 'event-valid', enabled: false,
        trigger: { type: 'event', on: ['goal:completed'], perGoalCooldown: '60s' },
        action: { type: 'memory:distill' },
      });
      expect(result.valid).toBe(true);
    });

    it('accepts valid cron trigger (backward compat)', () => {
      const engine = new AutomationEngine(tmpDir);
      const result = engine.validateRule({
        id: 'cron-valid', enabled: false,
        trigger: { type: 'cron', schedule: '0 0 * * *', timezone: 'UTC' },
        action: { type: 'memory:distill' },
      });
      expect(result.valid).toBe(true);
    });

    it('rejects invalid trigger type', () => {
      const engine = new AutomationEngine(tmpDir);
      const result = engine.validateRule({
        id: 'bad-trigger', enabled: false,
        trigger: { type: 'webhook' as any, schedule: '', timezone: '' },
        action: { type: 'memory:distill' },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('cron') && e.includes('event'))).toBe(true);
    });

    it('rejects event trigger with empty on array', () => {
      const engine = new AutomationEngine(tmpDir);
      const result = engine.validateRule({
        id: 'event-empty-on', enabled: false,
        trigger: { type: 'event', on: [], perGoalCooldown: '60s' },
        action: { type: 'memory:distill' },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('on'))).toBe(true);
    });

    it('rejects event trigger with missing on', () => {
      const engine = new AutomationEngine(tmpDir);
      const result = engine.validateRule({
        id: 'event-no-on', enabled: false,
        trigger: { type: 'event', on: undefined as any, perGoalCooldown: '60s' },
        action: { type: 'memory:distill' },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('on'))).toBe(true);
    });

    it('rejects event trigger with invalid perGoalCooldown', () => {
      const engine = new AutomationEngine(tmpDir);
      const result = engine.validateRule({
        id: 'event-bad-cooldown', enabled: false,
        trigger: { type: 'event', on: ['goal:completed'], perGoalCooldown: 'invalid' },
        action: { type: 'memory:distill' },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('perGoalCooldown'))).toBe(true);
    });

    it('rejects event trigger with missing perGoalCooldown', () => {
      const engine = new AutomationEngine(tmpDir);
      const result = engine.validateRule({
        id: 'event-no-cooldown', enabled: false,
        trigger: { type: 'event', on: ['goal:completed'], perGoalCooldown: undefined as any },
        action: { type: 'memory:distill' },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('perGoalCooldown'))).toBe(true);
    });

    it('rejects cron trigger with empty schedule', () => {
      const engine = new AutomationEngine(tmpDir);
      const result = engine.validateRule({
        id: 'cron-empty', enabled: false,
        trigger: { type: 'cron', schedule: '', timezone: 'UTC' },
        action: { type: 'memory:distill' },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Schedule'))).toBe(true);
    });
  });

  describe('getNextTriggers', () => {
    it('returns empty next5 for event triggers', () => {
      const engine = new AutomationEngine(tmpDir);
      const result = engine.getNextTriggers({
        id: 'event-next', enabled: true,
        trigger: { type: 'event', on: ['goal:completed'], perGoalCooldown: '60s' },
      });
      expect(result.next5).toEqual([]);
    });

    it('returns next 5 dates for cron triggers', () => {
      const engine = new AutomationEngine(tmpDir);
      const result = engine.getNextTriggers({
        id: 'cron-next', enabled: true,
        trigger: { type: 'cron', schedule: '0 0 * * *', timezone: 'UTC' },
      });
      expect(result.next5.length).toBe(5);
    });
  });

  describe('start() with mixed triggers', () => {
    it('handles event triggers without crashing', () => {
      const engine = new AutomationEngine(tmpDir);
      (engine as any).rules.set('event-rule', {
        id: 'event-rule', enabled: true,
        trigger: { type: 'event', on: ['goal:completed'], perGoalCooldown: '60s' },
      });
      (engine as any).rules.set('cron-rule', {
        id: 'cron-rule', enabled: true,
        trigger: { type: 'cron', schedule: '0 0 * * *', timezone: 'UTC' },
      });
      expect(() => engine.start()).not.toThrow();
    });
  });

  describe('toggleRule dispatch', () => {
    it('enables cron rule and schedules it', () => {
      const autoDir = path.join(tmpDir, 'automations');
      fs.mkdirSync(autoDir, { recursive: true });
      const rule: AutomationRule = {
        id: 'toggle-cron', enabled: false,
        trigger: { type: 'cron', schedule: '0 0 * * *', timezone: 'UTC' },
      };
      fs.writeFileSync(path.join(autoDir, 'toggle-cron.json'), JSON.stringify(rule));
      const engine = new AutomationEngine(tmpDir);
      const result = engine.toggleRule('toggle-cron', true);
      expect(result).toBe(true);
      expect((engine as any).jobs.has('toggle-cron')).toBe(true);
    });

    it('enables event rule without scheduling cron job', () => {
      const autoDir = path.join(tmpDir, 'automations');
      fs.mkdirSync(autoDir, { recursive: true });
      const rule: AutomationRule = {
        id: 'toggle-event', enabled: false,
        trigger: { type: 'event', on: ['goal:completed'], perGoalCooldown: '60s' },
      };
      fs.writeFileSync(path.join(autoDir, 'toggle-event.json'), JSON.stringify(rule));
      const engine = new AutomationEngine(tmpDir);
      const result = engine.toggleRule('toggle-event', true);
      expect(result).toBe(true);
      expect((engine as any).jobs.has('toggle-event')).toBe(false);
    });

    it('disabling event rule does not crash', () => {
      const autoDir = path.join(tmpDir, 'automations');
      fs.mkdirSync(autoDir, { recursive: true });
      const rule: AutomationRule = {
        id: 'toggle-event-off', enabled: true,
        trigger: { type: 'event', on: ['goal:completed'], perGoalCooldown: '60s' },
      };
      fs.writeFileSync(path.join(autoDir, 'toggle-event-off.json'), JSON.stringify(rule));
      const engine = new AutomationEngine(tmpDir);
      (engine as any).rules.set('toggle-event-off', rule);
      const result = engine.toggleRule('toggle-event-off', false);
      expect(result).toBe(true);
      expect((engine as any).rules.has('toggle-event-off')).toBe(false);
    });
  });
});
