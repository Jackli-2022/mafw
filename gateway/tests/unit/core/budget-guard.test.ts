import { BudgetGuard } from '../../../src/core/budget-guard';

function makeGuard(over: Partial<any> = {}) {
  const calls = { abort: [] as string[], notify: [] as string[] };
  const guard = new BudgetGuard({
    sessionID: 's1',
    maxTurns: 3,
    getCostUsd: () => 0,
    abort: async (sid: string) => { calls.abort.push(sid); },
    notify: async (sid: string, text: string) => { calls.notify.push(text); },
    ...over,
  });
  return { guard, calls };
}

const flush = () => new Promise((r) => setImmediate(r));

describe('BudgetGuard', () => {
  it('aborts and notifies when maxTurns exceeded', async () => {
    const { guard, calls } = makeGuard();
    guard.onStep(); guard.onStep();
    expect(calls.abort).toHaveLength(0);
    guard.onStep(); // 第 3 步触发
    await flush();
    expect(calls.abort).toEqual(['s1']);
    expect(calls.notify[0]).toMatch(/maxTurns/);
    expect(guard.triggered).toBe(true);
  });

  it('aborts when maxCostUsd exceeded', async () => {
    let cost = 0;
    const { guard, calls } = makeGuard({ maxTurns: undefined, maxCostUsd: 0.01, getCostUsd: () => cost });
    guard.onStep();
    cost = 0.02;
    guard.onStep();
    await flush();
    expect(calls.abort).toEqual(['s1']);
  });

  it('no budget configured → never triggers', () => {
    const { guard, calls } = makeGuard({ maxTurns: undefined, maxCostUsd: undefined });
    for (let i = 0; i < 10; i++) guard.onStep();
    expect(calls.abort).toHaveLength(0);
  });

  it('fires at most once; detach stops counting', async () => {
    const { guard, calls } = makeGuard({ maxTurns: 1 });
    guard.onStep();
    await flush();
    guard.onStep(); guard.onStep();
    await flush();
    expect(calls.abort).toHaveLength(1);
  });

  it('abort failure only logs (idempotent, no throw)', async () => {
    const { guard } = makeGuard({ maxTurns: 1, abort: async () => { throw new Error('already idle'); } });
    guard.onStep();
    await flush();
    expect(guard.triggered).toBe(true);
  });

  it('detach before any step → never fires', () => {
    const { guard, calls } = makeGuard({ maxTurns: 1 });
    guard.detach();
    guard.onStep();
    expect(calls.abort).toHaveLength(0);
    expect(guard.triggered).toBe(false);
  });
});
