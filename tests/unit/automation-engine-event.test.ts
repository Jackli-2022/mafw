import { AutomationEngine, AutomationRule, parseDuration } from '../../gateway/src/automation-engine';
import { eventBus } from '../../gateway/src/event-bus';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('AutomationEngine event trigger support', () => {
  let tmpDir: string;
  let engine: AutomationEngine;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-ae-event-'));
    engine = new AutomationEngine(tmpDir);
  });

  afterEach(() => {
    (engine as any).eventHandlerRefs.clear();
    (engine as any).eventListeners.clear();
    (engine as any).lastFireTimes.clear();
    (engine as any).reportedPairs.clear();
    eventBus.removeAllListeners();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  describe('parseDuration', () => {
    it('parses seconds', () => {
      expect(parseDuration('30s')).toBe(30000);
    });

    it('parses minutes', () => {
      expect(parseDuration('5m')).toBe(300000);
    });

    it('parses hours', () => {
      expect(parseDuration('2h')).toBe(7200000);
    });

    it('defaults to 60s for unknown suffix', () => {
      expect(parseDuration('10x')).toBe(undefined);
    });
  });

  describe('registering event trigger rules', () => {
    it('registers event listeners on start()', () => {
      const rule: AutomationRule = {
        id: 'test-event', enabled: true,
        trigger: { type: 'event', on: ['goal:completed', 'goal:failed'], perGoalCooldown: '60s' },
        action: { type: 'memory:distill' },
      };
      (engine as any).rules.set('test-event', rule);

      const onSpy = jest.spyOn(eventBus, 'on');
      engine.start();

      expect(onSpy).toHaveBeenCalledWith('goal:completed', expect.any(Function));
      expect(onSpy).toHaveBeenCalledWith('goal:failed', expect.any(Function));
      expect((engine as any).eventListeners.get('goal:completed').has('test-event')).toBe(true);
      expect((engine as any).eventListeners.get('goal:failed').has('test-event')).toBe(true);

      onSpy.mockRestore();
    });

    it('registers handler via eventBus', () => {
      const rule: AutomationRule = {
        id: 'handler-test', enabled: true,
        trigger: { type: 'event', on: ['state_change'], perGoalCooldown: '60s' },
        action: { type: 'memory:distill' },
      };
      (engine as any).rules.set('handler-test', rule);

      engine.start();

      const execSpy = jest.spyOn(engine, 'executeRule').mockResolvedValue(undefined);
      eventBus.emit('state_change', { goalId: 'g-1' });
      expect(execSpy).toHaveBeenCalledWith('handler-test', 'event', undefined);
      execSpy.mockRestore();
    });

    it('does not fire when goalId is missing', () => {
      const rule: AutomationRule = {
        id: 'no-goalId', enabled: true,
        trigger: { type: 'event', on: ['state_change'], perGoalCooldown: '60s' },
        action: { type: 'memory:distill' },
      };
      (engine as any).rules.set('no-goalId', rule);

      engine.start();

      const execSpy = jest.spyOn(engine, 'executeRule').mockResolvedValue(undefined);
      eventBus.emit('state_change', {});
      expect(execSpy).not.toHaveBeenCalled();
      execSpy.mockRestore();
    });
  });

  describe('cooldown', () => {
    it('prevents duplicate fires for same rule and goal within cooldown', () => {
      const rule: AutomationRule = {
        id: 'cooldown-test', enabled: true,
        trigger: { type: 'event', on: ['goal:completed'], perGoalCooldown: '60s' },
        action: { type: 'memory:distill' },
      };
      (engine as any).rules.set('cooldown-test', rule);

      const execSpy = jest.spyOn(engine, 'executeRule').mockResolvedValue(undefined);
      engine.start();

      eventBus.emit('goal:completed', { goalId: 'goal-1' });
      eventBus.emit('goal:completed', { goalId: 'goal-1' });

      expect(execSpy).toHaveBeenCalledTimes(1);
      execSpy.mockRestore();
    });

    it('allows fire for different goals', () => {
      const rule: AutomationRule = {
        id: 'diff-goal-test', enabled: true,
        trigger: { type: 'event', on: ['goal:completed'], perGoalCooldown: '60s' },
        action: { type: 'memory:distill' },
      };
      (engine as any).rules.set('diff-goal-test', rule);

      const execSpy = jest.spyOn(engine, 'executeRule').mockResolvedValue(undefined);
      engine.start();

      eventBus.emit('goal:completed', { goalId: 'goal-1' });
      eventBus.emit('goal:completed', { goalId: 'goal-2' });

      expect(execSpy).toHaveBeenCalledTimes(2);
      execSpy.mockRestore();
    });

    it('fires after cooldown expires', async () => {
      const stateDir = path.join(tmpDir, 'state');
      fs.mkdirSync(stateDir, { recursive: true });
      const stateFile = path.join(stateDir, 'goal-cd.json');

      const rule: AutomationRule = {
        id: 'cooldown-expire', enabled: true,
        trigger: { type: 'event', on: ['goal:completed'], perGoalCooldown: '1s' },
        action: { type: 'memory:distill' },
      };
      (engine as any).rules.set('cooldown-expire', rule);

      const execSpy = jest.spyOn(engine, 'executeRule').mockResolvedValue(undefined);
      engine.start();

      fs.writeFileSync(stateFile, JSON.stringify({ stateVersion: 1 }));
      eventBus.emit('goal:completed', { goalId: 'goal-cd' });
      await new Promise(r => setTimeout(r, 1100));
      fs.writeFileSync(stateFile, JSON.stringify({ stateVersion: 2 }));
      eventBus.emit('goal:completed', { goalId: 'goal-cd' });

      expect(execSpy).toHaveBeenCalledTimes(2);
      execSpy.mockRestore();
    }, 10000);
  });

  describe('state version dedup', () => {
    it('deduplicates same state version', () => {
      const stateDir = path.join(tmpDir, 'state');
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(path.join(stateDir, 'goal-1.json'), JSON.stringify({ stateVersion: 1 }));

      const rule: AutomationRule = {
        id: 'dedup-test', enabled: true,
        trigger: { type: 'event', on: ['state_change'], perGoalCooldown: '0s' },
        action: { type: 'memory:distill' },
      };
      (engine as any).rules.set('dedup-test', rule);

      const execSpy = jest.spyOn(engine, 'executeRule').mockResolvedValue(undefined);
      engine.start();

      eventBus.emit('state_change', { goalId: 'goal-1' });
      eventBus.emit('state_change', { goalId: 'goal-1' });

      expect(execSpy).toHaveBeenCalledTimes(1);
      execSpy.mockRestore();
    });

    it('allows fire when state version changes', () => {
      const stateDir = path.join(tmpDir, 'state');
      fs.mkdirSync(stateDir, { recursive: true });
      const stateFile = path.join(stateDir, 'goal-1.json');

      const rule: AutomationRule = {
        id: 'dedup-change', enabled: true,
        trigger: { type: 'event', on: ['state_change'], perGoalCooldown: '0s' },
        action: { type: 'memory:distill' },
      };
      (engine as any).rules.set('dedup-change', rule);

      const execSpy = jest.spyOn(engine, 'executeRule').mockResolvedValue(undefined);
      engine.start();

      fs.writeFileSync(stateFile, JSON.stringify({ stateVersion: 1 }));
      eventBus.emit('state_change', { goalId: 'goal-1' });

      fs.writeFileSync(stateFile, JSON.stringify({ stateVersion: 2 }));
      eventBus.emit('state_change', { goalId: 'goal-1' });

      expect(execSpy).toHaveBeenCalledTimes(2);
      execSpy.mockRestore();
    });
  });

  describe('unregistering on disable', () => {
    it('unregisters event listeners via toggleRule(false)', () => {
      const autoDir = path.join(tmpDir, 'automations');
      fs.mkdirSync(autoDir, { recursive: true });
      const rule: AutomationRule = {
        id: 'disable-test', enabled: true,
        trigger: { type: 'event', on: ['goal:completed'], perGoalCooldown: '0s' },
        action: { type: 'memory:distill' },
      };
      fs.writeFileSync(path.join(autoDir, 'disable-test.json'), JSON.stringify(rule));

      engine.loadRules();
      engine.start();

      const execSpy = jest.spyOn(engine, 'executeRule').mockResolvedValue(undefined);

      eventBus.emit('goal:completed', { goalId: 'goal-1' });
      expect(execSpy).toHaveBeenCalledTimes(1);

      engine.toggleRule('disable-test', false);

      execSpy.mockClear();
      eventBus.emit('goal:completed', { goalId: 'goal-2' });
      expect(execSpy).not.toHaveBeenCalled();

      execSpy.mockRestore();
    });

    it('re-registers event listeners via toggleRule(true)', () => {
      const autoDir = path.join(tmpDir, 'automations');
      fs.mkdirSync(autoDir, { recursive: true });
      const rule: AutomationRule = {
        id: 're-enable', enabled: false,
        trigger: { type: 'event', on: ['goal:completed'], perGoalCooldown: '0s' },
        action: { type: 'memory:distill' },
      };
      fs.writeFileSync(path.join(autoDir, 're-enable.json'), JSON.stringify(rule));

      engine.loadRules();
      engine.start();

      const execSpy = jest.spyOn(engine, 'executeRule').mockResolvedValue(undefined);

      engine.toggleRule('re-enable', true);

      eventBus.emit('goal:completed', { goalId: 'goal-1' });
      expect(execSpy).toHaveBeenCalledTimes(1);

      execSpy.mockRestore();
    });
  });

  describe('stop() cleanup', () => {
    it('removes all event listeners from eventBus on stop()', () => {
      const rule: AutomationRule = {
        id: 'stop-test', enabled: true,
        trigger: { type: 'event', on: ['goal:completed'], perGoalCooldown: '0s' },
        action: { type: 'memory:distill' },
      };
      (engine as any).rules.set('stop-test', rule);

      engine.start();
      engine.stop();

      const execSpy = jest.spyOn(engine, 'executeRule').mockResolvedValue(undefined);
      eventBus.emit('goal:completed', { goalId: 'goal-1' });
      expect(execSpy).not.toHaveBeenCalled();
      execSpy.mockRestore();
    });

    it('clears eventHandlerRefs map', () => {
      const rule: AutomationRule = {
        id: 'cleanup-refs', enabled: true,
        trigger: { type: 'event', on: ['goal:completed'], perGoalCooldown: '60s' },
        action: { type: 'memory:distill' },
      };
      (engine as any).rules.set('cleanup-refs', rule);

      engine.start();
      expect((engine as any).eventHandlerRefs.size).toBe(1);

      engine.stop();
      expect((engine as any).eventHandlerRefs.size).toBe(0);
    });

    it('clears eventListeners map', () => {
      const rule: AutomationRule = {
        id: 'cleanup-listeners', enabled: true,
        trigger: { type: 'event', on: ['goal:failed'], perGoalCooldown: '60s' },
        action: { type: 'memory:distill' },
      };
      (engine as any).rules.set('cleanup-listeners', rule);

      engine.start();
      expect((engine as any).eventListeners.get('goal:failed').has('cleanup-listeners')).toBe(true);

      engine.stop();
      expect((engine as any).eventListeners.get('goal:failed')?.has('cleanup-listeners')).toBeFalsy();
    });
  });
});
