/**
 * E4-6 子进程台账（spec §4.6）。
 *
 * 台账是「gateway 到底开了几个子进程」的唯一真相：release 必须幂等
 * （child exit + kill 两条路径都会释放），disposeAll 的 close 钩子必须
 * best-effort（一个抛错不能把其余进程留在后台），snapshot 里不能泄漏
 * 不可序列化的 close 闭包。
 */
import { ProcessLedger } from '../../../src/resources/process-ledger';

describe('ProcessLedger: register / release', () => {
  it('assigns unique ids and counts by kind', () => {
    const ledger = new ProcessLedger();
    const a = ledger.register({ kind: 'python', sessionId: 's1', label: 'python kernel' });
    const b = ledger.register({ kind: 'python', sessionId: 's2' });
    const c = ledger.register({ kind: 'llamacpp', pid: 4242, label: 'llama-server' });

    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
    expect(ledger.count()).toBe(3);
    expect(ledger.count('python')).toBe(2);
    expect(ledger.count('llamacpp')).toBe(1);
    expect(ledger.count('serve')).toBe(0);
  });

  it('release removes the entry and is idempotent', () => {
    const ledger = new ProcessLedger();
    const handle = ledger.register({ kind: 'llamacpp', pid: 7 });
    handle.release();
    handle.release();
    expect(ledger.count()).toBe(0);
    expect(ledger.list()).toEqual([]);
  });

  it('keeps other entries when one is released', () => {
    const ledger = new ProcessLedger();
    const a = ledger.register({ kind: 'python', sessionId: 's1' });
    ledger.register({ kind: 'python', sessionId: 's2' });
    a.release();
    expect(ledger.list().map((e) => e.sessionId)).toEqual(['s2']);
  });

  it('stamps startedAt lazily and honours an explicit one', () => {
    const ledger = new ProcessLedger();
    const before = Date.now();
    ledger.register({ kind: 'serve', label: 'sidecar' });
    ledger.register({ kind: 'python', startedAt: 1234 });
    const entries = ledger.list();
    expect(entries[0].startedAt).toBeGreaterThanOrEqual(before);
    expect(entries[1].startedAt).toBe(1234);
  });
});

describe('ProcessLedger: list / snapshot', () => {
  it('list returns detached copies (mutating them cannot corrupt the ledger)', () => {
    const ledger = new ProcessLedger();
    ledger.register({ kind: 'python', sessionId: 's1' });
    const first = ledger.list();
    first[0].label = 'tampered';
    expect(ledger.list()[0].label).toBeUndefined();
  });

  it('snapshot reports total, zero-filled byKind, and close-free entries', () => {
    const ledger = new ProcessLedger();
    ledger.register({ kind: 'python', sessionId: 's1', close: () => undefined });
    ledger.register({ kind: 'llamacpp', pid: 9 });
    const snap = ledger.snapshot();

    expect(snap.total).toBe(2);
    expect(snap.byKind).toEqual({ python: 1, llamacpp: 1, serve: 0 });
    expect(snap.entries).toHaveLength(2);
    expect(Object.keys(snap.entries[0])).not.toContain('close');
    expect(snap.entries[0].kind).toBe('python');
  });
});

describe('ProcessLedger: disposeAll', () => {
  it('calls close hooks best-effort then clears everything', () => {
    const ledger = new ProcessLedger();
    const closed: string[] = [];
    ledger.register({
      kind: 'llamacpp',
      close: () => {
        closed.push('a');
        throw new Error('kill failed');
      },
    });
    ledger.register({ kind: 'python', close: () => closed.push('b') });

    expect(() => ledger.disposeAll()).not.toThrow();
    expect(closed).toEqual(['a', 'b']);
    expect(ledger.count()).toBe(0);
    expect(ledger.snapshot()).toEqual({ total: 0, byKind: { python: 0, llamacpp: 0, serve: 0 }, entries: [] });
  });

  it('makes outstanding handles no-ops after disposeAll', () => {
    const ledger = new ProcessLedger();
    const handle = ledger.register({ kind: 'python', close: () => undefined });
    ledger.disposeAll();
    expect(() => handle.release()).not.toThrow();
    expect(ledger.count()).toBe(0);
  });
});
