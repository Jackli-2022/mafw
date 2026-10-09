import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GatewayDatabase } from '../../../src/memory/gateway-db';
import { TrajectoryStore } from '../../../src/trajectory/trajectory-store';
import { PipelineBudget } from '../../../src/recall/pipeline-budget';

describe('PipelineBudget', () => {
  const makeBudget = (opts: {
    spend: number;
    budget: number;
    now?: () => Date;
    logs?: string[];
  }) => {
    const logs = opts.logs ?? [];
    const budget = new PipelineBudget({
      getSpendToday: () => opts.spend,
      budgetUsdPerDay: opts.budget,
      now: opts.now,
      log: (msg) => logs.push(msg),
    });
    return { budget, logs };
  };

  test('budget 0 = unlimited', () => {
    const { budget } = makeBudget({ spend: 999, budget: 0 });
    expect(budget.allow('extract')).toBe(true);
  });

  test('allows when spend below budget', () => {
    const { budget } = makeBudget({ spend: 0.5, budget: 1 });
    expect(budget.allow('extract')).toBe(true);
  });

  test('denies when spend reaches budget', () => {
    const { budget } = makeBudget({ spend: 1, budget: 1 });
    expect(budget.allow('extract')).toBe(false);
    expect(makeBudget({ spend: 1.01, budget: 1 }).budget.allow('reflect')).toBe(false);
  });

  test('denial logs once per pipeline per day', () => {
    const { budget, logs } = makeBudget({ spend: 5, budget: 1 });
    expect(budget.allow('extract')).toBe(false);
    expect(budget.allow('extract')).toBe(false);
    expect(budget.allow('reflect')).toBe(false);
    expect(logs.filter((l) => l.includes('extract')).length).toBe(1);
    expect(logs.filter((l) => l.includes('reflect')).length).toBe(1);
  });

  test('day rollover re-allows and re-logs', () => {
    let day = new Date('2026-10-09T10:00:00Z');
    const { budget, logs } = makeBudget({ spend: 5, budget: 1, now: () => day });
    expect(budget.allow('extract')).toBe(false);
    expect(logs.length).toBe(1);
    day = new Date('2026-10-10T10:00:00Z');
    expect(budget.allow('extract')).toBe(false);
    expect(logs.length).toBe(2);
  });

  test('negative budget treated as unlimited', () => {
    const { budget } = makeBudget({ spend: 999, budget: -1 });
    expect(budget.allow('extract')).toBe(true);
  });
});

describe('TrajectoryStore.getWorkerSpendSince', () => {
  let db: GatewayDatabase;
  let tmpDir: string;
  let store: TrajectoryStore;

  const insertTurn = (opts: { turnID: number; cost: number; workerRole?: string; ageSec?: number }) => {
    store.upsertTurn({
      projectID: 'p1',
      sessionID: 's1',
      turnID: opts.turnID,
      turnStartMs: Date.now(),
      turnEndMs: Date.now(),
      durationMs: 1000,
      toolCount: 0, toolErrorCount: 0, reasoningCount: 0, agentSwitchCount: 0,
      tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
      cost: opts.cost,
      finish: 'stop',
      model: 'mimo-v2.5',
      provider: 'xiaomi',
      agent: 'build',
      userText: 'hi',
      workerRole: opts.workerRole,
    } as any);
    if (opts.ageSec) {
      const created = Math.floor(Date.now() / 1000) - opts.ageSec;
      (db as any).db
        .prepare('UPDATE trajectory_turns SET created_at = ? WHERE session_id = ? AND turn_id = ?')
        .run(created, 's1', opts.turnID);
    }
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-spend-'));
    db = new GatewayDatabase(path.join(tmpDir, 'test.db'));
    store = new TrajectoryStore(db, 'p1');
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('sums cost of worker-role turns since cutoff', () => {
    insertTurn({ turnID: 1, cost: 0.5, workerRole: 'extract' });
    insertTurn({ turnID: 2, cost: 0.25, workerRole: 'reflect' });
    insertTurn({ turnID: 3, cost: 0.1, workerRole: 'index-scan' });
    const since = Math.floor(Date.now() / 1000) - 3600;
    expect(store.getWorkerSpendSince(since)).toBeCloseTo(0.85, 5);
  });

  test('excludes turns without worker role', () => {
    insertTurn({ turnID: 1, cost: 9.9 });
    insertTurn({ turnID: 2, cost: 0.1, workerRole: 'extract' });
    const since = Math.floor(Date.now() / 1000) - 3600;
    expect(store.getWorkerSpendSince(since)).toBeCloseTo(0.1, 5);
  });

  test('excludes turns older than cutoff', () => {
    insertTurn({ turnID: 1, cost: 5, workerRole: 'extract', ageSec: 7200 });
    insertTurn({ turnID: 2, cost: 0.3, workerRole: 'extract' });
    const since = Math.floor(Date.now() / 1000) - 3600;
    expect(store.getWorkerSpendSince(since)).toBeCloseTo(0.3, 5);
  });

  test('null cost counts as zero', () => {
    insertTurn({ turnID: 1, cost: 0, workerRole: 'extract' });
    const since = Math.floor(Date.now() / 1000) - 3600;
    expect(store.getWorkerSpendSince(since)).toBe(0);
  });
});
