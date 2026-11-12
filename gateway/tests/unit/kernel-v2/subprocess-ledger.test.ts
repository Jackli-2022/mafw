import { SubprocessLedger, type SubprocessHandle } from '../../../src/kernel-v2/subprocess-ledger';

function handle(pid: number, over: Partial<SubprocessHandle> = {}): SubprocessHandle {
  return { pid, stop: async () => {}, ...over };
}

describe('SubprocessLedger', () => {
  test('tracks a spawned child and exposes it as active', () => {
    const ledger = new SubprocessLedger();
    ledger.track('qwen3', handle(1234));
    ledger.markRunning('qwen3');
    expect(ledger.active()).toEqual([
      expect.objectContaining({ id: 'qwen3', pid: 1234, ownership: 'provider', state: 'running' }),
    ]);
  });

  test('rejects duplicate ids instead of overwriting a live handle', () => {
    const ledger = new SubprocessLedger();
    ledger.track('qwen3', handle(1));
    expect(() => ledger.track('qwen3', handle(2))).toThrow(/already tracked/);
  });

  test('adopted processes are never stopped by dispose', async () => {
    let stops = 0;
    const ledger = new SubprocessLedger();
    ledger.adopt(
      'external',
      handle(9, {
        stop: async () => {
          stops += 1;
        },
      }),
    );
    await ledger.dispose();
    expect(stops).toBe(0);
    expect(ledger.snapshot()[0]).toMatchObject({ ownership: 'external', state: 'stopped' });
  });

  test('dispose stops owned processes in reverse order and isolates failures', async () => {
    const order: string[] = [];
    const ledger = new SubprocessLedger();
    ledger.track(
      'a',
      handle(1, {
        stop: async () => {
          order.push('a');
        },
      }),
    );
    ledger.track(
      'b',
      handle(2, {
        stop: async () => {
          order.push('b');
          throw new Error('boom');
        },
      }),
    );
    const errors = await ledger.dispose();
    expect(order).toEqual(['b', 'a']);
    expect(errors).toEqual([{ id: 'b', error: 'boom' }]);
    await expect(ledger.dispose()).resolves.toEqual([]);
  });

  test('failed and stopped records stay in the snapshot for diagnostics', () => {
    const ledger = new SubprocessLedger();
    ledger.track('a', handle(1));
    ledger.markFailed('a', 'health timeout');
    ledger.track('b', handle(2));
    ledger.markStopped('b');
    expect(ledger.active()).toEqual([]);
    expect(ledger.snapshot()).toEqual([
      expect.objectContaining({ id: 'a', state: 'failed', reason: 'health timeout' }),
      expect.objectContaining({ id: 'b', state: 'stopped' }),
    ]);
  });
});
