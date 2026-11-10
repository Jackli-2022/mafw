// AutomationEngine: instance-owned action registry + live-instance discipline
// + scheduler submission.
// Plan: docs/superpowers/plans/2026-11-10-gateway-kernel-scheduler.md (Task 2)
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  AutomationEngine,
  AutomationRule,
} from '../../src/automation-engine';
import { Scheduler, BudgetExceededError } from '../../src/scheduler';
import { log } from '../../src/core/utils/logger';

const DAY = 24 * 60 * 60 * 1000;

function manual<T = void>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const rule: AutomationRule = {
  id: 'r1',
  enabled: true,
  trigger: { type: 'cron', schedule: '0 * * * *', timezone: 'UTC' },
};

function writeV2Index(dir: string): void {
  const memDir = path.join(dir, 'memory');
  fs.mkdirSync(memDir, { recursive: true });
  fs.writeFileSync(
    path.join(memDir, '.harmonic_index.json'),
    JSON.stringify(
      {
        version: 2,
        updated_at: new Date().toISOString(),
        entries: [
          {
            id: 'm1',
            type: 'semantic',
            primary_abstraction: 'test memory',
            cue_anchors: [],
            tier: 'semantic',
            energy: 0.9,
            salience: 1,
            created_at: new Date(Date.now() - 10 * DAY).toISOString(),
            last_decay_at: new Date(Date.now() - 2 * DAY).toISOString(),
          },
        ],
      },
      null,
      2,
    ),
    'utf-8',
  );
}

function readEnergy(dir: string): number {
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'memory', '.harmonic_index.json'), 'utf-8'));
  return raw.entries[0].energy;
}

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'automation-'));
}

describe('AutomationEngine action registry lifecycle', () => {
  it('constructor registers builtin actions', () => {
    const dir = tmp();
    const engine = new AutomationEngine(dir);
    expect(engine.getAction('memory:decay')).toBeDefined();
    expect(engine.getAction('memory:review')).toBeDefined();
    expect(engine.getAction('memory:prune')).toBeDefined();
  });

  it('refreshActions rebuilds: provider actions survive, bare registrations are wiped', () => {
    const dir = tmp();
    const engine = new AutomationEngine(dir);
    engine.setActionsProvider(() => {
      engine.registerAction('custom:x', async () => {});
    });
    engine.registerAction('bare:y', async () => {});
    expect(engine.hasAction('bare:y')).toBe(true);
    engine.refreshActions();
    expect(engine.hasAction('custom:x')).toBe(true); // re-registered via provider
    expect(engine.hasAction('bare:y')).toBe(false); // wiped — lifecycle is explicit
    expect(engine.hasAction('memory:decay')).toBe(true); // builtins re-registered
  });

  it('refreshActions during an in-flight action leaves the running handler unaffected', async () => {
    const dir = tmp();
    const engine = new AutomationEngine(dir);
    const gate = manual();
    let finished = false;
    engine.setActionsProvider(() => {
      engine.registerAction('test:long', async () => {
        await gate.promise;
        finished = true;
      });
    });
    engine.refreshActions();
    const run = (engine as any).executeAction('test:long', rule, 'cron');
    engine.refreshActions(); // rebuild mid-flight
    gate.resolve(undefined);
    await run;
    expect(finished).toBe(true);
  });
});

describe('AutomationEngine scheduler submission', () => {
  it('without scheduler, executeAction calls the handler directly', async () => {
    const dir = tmp();
    const engine = new AutomationEngine(dir);
    let called = false;
    engine.registerAction('test:plain', async () => {
      called = true;
    });
    await (engine as any).executeAction('test:plain', rule, 'cron');
    expect(called).toBe(true);
  });

  it('with scheduler, concurrent same-action runs collapse to one (skip)', async () => {
    const dir = tmp();
    const s = new Scheduler();
    const engine = new AutomationEngine(dir);
    engine.setScheduler(s);
    const gate = manual();
    let calls = 0;
    engine.registerAction('test:slow', () => {
      calls++;
      return gate.promise;
    });
    const p1 = (engine as any).executeAction('test:slow', rule, 'cron');
    const p2 = (engine as any).executeAction('test:slow', rule, 'cron');
    gate.resolve(undefined);
    await p1;
    await p2; // second resolves via the skip branch (logged, not thrown)
    expect(calls).toBe(1);
  });

  it('with scheduler + taskOpts timeoutMs, executeAction resolves on watchdog while fn continues', async () => {
    const dir = tmp();
    const s = new Scheduler();
    const engine = new AutomationEngine(dir);
    engine.setScheduler(s);
    const gate = manual();
    let finished = false;
    engine.registerAction(
      'test:to',
      () =>
        gate.promise.then(() => {
          finished = true;
        }),
      { timeoutMs: 20 },
    );
    const p = (engine as any).executeAction('test:to', rule, 'cron');
    await p; // resolves at watchdog (20ms)
    expect(finished).toBe(false);
    gate.resolve(undefined);
    await new Promise((r) => setTimeout(r, 10));
    expect(finished).toBe(true); // abandoned fn still settles in the background
  });

  it('user/llm-triggered actions submit as foreground: defer-to-idle tasks wait for them', async () => {
    const dir = tmp();
    const s = new Scheduler();
    const engine = new AutomationEngine(dir);
    engine.setScheduler(s);
    const gate = manual();
    engine.registerAction('test:fg', async () => {
      await gate.promise;
    });
    const run = (engine as any).executeAction('test:fg', rule, 'user');
    let idleStarted = false;
    const idle = s.submit(
      { priority: 'midground', mutexKey: 'snap', strategy: 'defer-to-idle' },
      async () => {
        idleStarted = true;
      },
    );
    expect(idleStarted).toBe(false); // foreground in flight blocks the idle-deferred task
    gate.resolve(undefined);
    await run;
    await idle;
    expect(idleStarted).toBe(true);
  });

  it('taskOpts budget is passed through: denied budget → handler never runs, executeAction resolves', async () => {
    const dir = tmp();
    const s = new Scheduler({ budgetChecker: () => ({ ok: false, reason: 'daily cap' }) });
    const engine = new AutomationEngine(dir);
    engine.setScheduler(s);
    let ran = false;
    engine.registerAction(
      'test:budget',
      async () => {
        ran = true;
      },
      { budget: { kind: 'pipeline', pipeline: 'extract' } },
    );
    await (engine as any).executeAction('test:budget', rule, 'cron');
    expect(ran).toBe(false); // admission denied — logged as warn, not thrown
    // The error class is only reachable directly via the scheduler:
    await expect(
      s.submit(
        { priority: 'background', strategy: 'skip', budget: { kind: 'pipeline', pipeline: 'extract' } },
        async () => {},
      ),
    ).rejects.toBeInstanceOf(BudgetExceededError);
  });
});

describe('AutomationEngine live-instance discipline', () => {
  it('memory:decay without an index provider warns and returns — energy unchanged', async () => {
    const dir = tmp();
    writeV2Index(dir);
    const engine = new AutomationEngine(dir); // no setIndexManagerProvider
    const action = engine.getAction('memory:decay')!;
    await action(rule, engine);
    expect(readEnergy(dir)).toBeCloseTo(0.9, 5);
  });

  it('memory:prune without a graph provider warns and returns without error', async () => {
    const dir = tmp();
    const engine = new AutomationEngine(dir); // no setGraphProvider
    const action = engine.getAction('memory:prune')!;
    await expect(action(rule, engine)).resolves.toBeUndefined();
  });
});

describe('B2 minors: ids, statuses, throw parity', () => {
  it('sequential timed-out runs produce distinct task ids (M2)', async () => {
    const dir = tmp();
    const s = new Scheduler();
    const engine = new AutomationEngine(dir);
    engine.setScheduler(s);
    const warns: string[] = [];
    const spy = jest.spyOn(log, 'warn').mockImplementation((m: string) => { warns.push(m); });
    try {
      // never-resolving handler: both runs hit the 15ms watchdog
      engine.registerAction('test:ids', () => new Promise(() => {}), { timeoutMs: 15 });
      await (engine as any).executeAction('test:ids', rule, 'cron');
      await new Promise((r) => setTimeout(r, 25));
      await (engine as any).executeAction('test:ids', rule, 'cron');
      await new Promise((r) => setTimeout(r, 25));
      const idWarns = warns.filter((w) => w.includes('watchdog timeout'));
      expect(idWarns.length).toBe(2);
      expect(idWarns[0]).not.toBe(idWarns[1]);
    } finally {
      spy.mockRestore();
    }
  });

  it('executeAction returns a status: ran / skipped (M3)', async () => {
    const dir = tmp();
    const s = new Scheduler();
    const engine = new AutomationEngine(dir);
    engine.setScheduler(s);
    const gate = manual();
    let calls = 0;
    engine.registerAction('test:st', () => {
      calls++;
      return gate.promise;
    });
    const r1 = (engine as any).executeAction('test:st', rule, 'cron');
    const r2 = (engine as any).executeAction('test:st', rule, 'cron'); // skip branch
    gate.resolve(undefined);
    expect(await r1).toBe('ran');
    expect(await r2).toBe('skipped');
    expect(calls).toBe(1);
    // No-scheduler path returns statuses too.
    const engine2 = new AutomationEngine(dir);
    engine2.registerAction('test:st2', async () => {});
    expect(await (engine2 as any).executeAction('test:st2', rule, 'cron')).toBe('ran');
    expect(await (engine2 as any).executeAction('missing:action', rule, 'cron')).toBe('missing');
  });

  it('runRuleFromLLM message reflects the budget-denied status (M3)', async () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'automations'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'automations', 'r1.json'),
      JSON.stringify({
        id: 'r1',
        enabled: true,
        trigger: { type: 'cron', schedule: '0 * * * *', timezone: 'UTC' },
        action: { type: 'test:x' },
      }),
      'utf-8',
    );
    const s = new Scheduler({ budgetChecker: () => ({ ok: false, reason: 'daily cap' }) });
    const engine = new AutomationEngine(dir);
    engine.setScheduler(s);
    let ran = false;
    engine.registerAction('test:x', async () => { ran = true; }, { budget: { kind: 'pipeline', pipeline: 'extract' } });
    engine.loadRules();
    const ledger = { append: () => {} } as any;
    const res = await engine.runRuleFromLLM('r1', ledger);
    expect(ran).toBe(false);
    expect(res.message).toContain('denied');
    expect(res.message).not.toContain('executed');
  });

  it('no-scheduler path survives a thrown null (err.message access, M4)', async () => {
    const dir = tmp();
    const engine = new AutomationEngine(dir);
    engine.registerAction('test:null', (async () => {
      throw null;
    }) as any);
    const status = await (engine as any).executeAction('test:null', rule, 'cron');
    expect(status).toBe('error');
  });
});
