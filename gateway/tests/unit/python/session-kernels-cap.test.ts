/**
 * E4-6 Python 内核并发帽（spec §4.6）。
 *
 * 到达上限时先驱逐 `lastUsed` 超过 idleEvictMs 的空闲内核（最旧优先），
 * 仍满才抛 QuotaExceededError（429 由路由映射）。真实 spawn 不参与：
 * KernelManager 在 ensureStarted() 之前不会拉起子进程，dispose() 是纯清理。
 */
import { KernelManager, SessionKernels } from '../../../src/python/kernel-service';
import { ProcessLedger } from '../../../src/resources/process-ledger';
import { QuotaExceededError } from '../../../src/resources/quotas';

const IDLE_MS = 10 * 60_000;

describe('SessionKernels: concurrency cap', () => {
  let kernels: SessionKernels | undefined;

  afterEach(() => {
    kernels?.disposeAll();
    kernels = undefined;
  });

  it('throws QuotaExceededError when full and nothing is idle', () => {
    kernels = new SessionKernels('python', { maxKernels: () => 2 });
    kernels.get('a');
    kernels.get('b');

    let err: any;
    try {
      kernels.get('c');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(QuotaExceededError);
    expect(err.code).toBe('quota_exceeded');
    expect(err.resource).toBe('python_kernels');
    expect(err.limit).toBe(2);
    expect(err.current).toBe(2);
    expect(kernels.count()).toBe(2);
  });

  it('returns the existing kernel for a known session even at the cap', () => {
    kernels = new SessionKernels('python', { maxKernels: () => 1 });
    const a = kernels.get('a');
    expect(kernels.get('a')).toBe(a);
    expect(kernels.count()).toBe(1);
  });

  it('evicts only kernels idle longer than idleEvictMs, oldest first', () => {
    let now = 1_000_000;
    kernels = new SessionKernels('python', {
      maxKernels: () => 2,
      idleEvictMs: IDLE_MS,
      now: () => now,
    });
    const a = kernels.get('a');
    const aDispose = jest.spyOn(a, 'dispose');
    now += 5 * 60_000;
    const b = kernels.get('b');
    const bDispose = jest.spyOn(b, 'dispose');
    now += 6 * 60_000; // a idle 11min, b idle 6min

    const c = kernels.get('c');

    expect(aDispose).toHaveBeenCalledTimes(1);
    expect(bDispose).not.toHaveBeenCalled();
    expect(kernels.count()).toBe(2);
    expect(kernels.get('b')).toBe(b);
    expect(kernels.get('c')).toBe(c);
  });

  it('evicts idle kernels until a slot frees up, then admits the new one', () => {
    let now = 0;
    kernels = new SessionKernels('python', {
      maxKernels: () => 2,
      idleEvictMs: IDLE_MS,
      now: () => now,
    });
    kernels.get('a');
    kernels.get('b');
    now += IDLE_MS + 1;

    expect(() => kernels.get('c')).not.toThrow();
    expect(kernels.count()).toBe(2);
    expect(kernels.entries().map((e) => e.sessionId).sort()).toEqual(['b', 'c']);
  });

  it('treats limit 0 as unlimited', () => {
    kernels = new SessionKernels('python', { maxKernels: () => 0 });
    for (const id of ['a', 'b', 'c', 'd', 'e']) kernels.get(id);
    expect(kernels.count()).toBe(5);
  });

  it('keeps the no-options constructor compatible (default unlimited pool)', () => {
    kernels = new SessionKernels('python');
    expect(kernels.get('a')).toBeInstanceOf(KernelManager);
  });
});

describe('SessionKernels: process ledger', () => {
  let kernels: SessionKernels | undefined;

  afterEach(() => {
    kernels?.disposeAll();
    kernels = undefined;
  });

  it('registers a python entry per created kernel and releases on disposeAll', () => {
    const ledger = new ProcessLedger();
    kernels = new SessionKernels('python', { ledger, maxKernels: () => 4 });
    kernels.get('a');
    kernels.get('b');
    expect(ledger.count('python')).toBe(2);
    expect(ledger.list().map((e) => e.sessionId).sort()).toEqual(['a', 'b']);

    kernels.disposeAll();
    expect(ledger.count('python')).toBe(0);
  });

  it('releases the handle when a kernel is evicted', () => {
    let now = 0;
    const ledger = new ProcessLedger();
    kernels = new SessionKernels('python', {
      ledger,
      maxKernels: () => 1,
      idleEvictMs: IDLE_MS,
      now: () => now,
    });
    kernels.get('a');
    now += IDLE_MS + 1;
    kernels.get('b');
    expect(ledger.count('python')).toBe(1);
    expect(ledger.list()[0].sessionId).toBe('b');
  });

  it('exposes count()/entries() for stats', () => {
    const ledger = new ProcessLedger();
    kernels = new SessionKernels('python', { ledger, maxKernels: () => 4 });
    kernels.get('a');
    expect(kernels.count()).toBe(1);
    const entries = kernels.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0].sessionId).toBe('a');
    expect(typeof entries[0].lastUsed).toBe('number');
  });
});
