import { Guard, GuardTimeoutError } from '../../../src/concurrency/guard';

describe('Guard', () => {
  it('skip mode: second call returns null while first is in flight', async () => {
    const guard = new Guard();
    let calls = 0;

    const p1 = guard.run('key', async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 50));
      return 'first';
    }, { onConflict: 'skip' });

    const p2 = guard.run('key', async () => {
      calls++;
      return 'second';
    }, { onConflict: 'skip' });

    expect(await p1).toBe('first');
    expect(await p2).toBeNull();
    expect(calls).toBe(1);
  });

  it('skip mode: after first completes, next call runs', async () => {
    const guard = new Guard();

    await guard.run('key', async () => 'first', { onConflict: 'skip' });

    const result = await guard.run('key', async () => 'second', { onConflict: 'skip' });
    expect(result).toBe('second');
  });

  it('queue mode: second call waits for first, then runs', async () => {
    const guard = new Guard();
    const order: string[] = [];

    const p1 = guard.run('key', async () => {
      await new Promise((r) => setTimeout(r, 50));
      order.push('first-done');
      return 'first';
    }, { onConflict: 'queue' });

    const p2 = guard.run('key', async () => {
      order.push('second-started');
      return 'second';
    }, { onConflict: 'queue' });

    expect(await p1).toBe('first');
    expect(await p2).toBe('second');
    expect(order).toEqual(['first-done', 'second-started']);
  });

  it('queue mode: FIFO order is preserved', async () => {
    const guard = new Guard();
    const order: string[] = [];

    const tasks = ['A', 'B', 'C'].map((name) =>
      guard.run('key', async () => {
        order.push(name);
        if (name === 'A') await new Promise((r) => setTimeout(r, 40));
        return name;
      }, { onConflict: 'queue' }),
    );

    await Promise.all(tasks);
    expect(order).toEqual(['A', 'B', 'C']);
  });

  it('timeout releases the lock (subsequent calls can run)', async () => {
    const guard = new Guard();
    const slowFn = () => new Promise<string>((r) => setTimeout(() => r('slow'), 200));

    // Start a task that would hold the lock for 200ms, but timeout at 50ms
    const p1 = guard.run('key', slowFn, { onConflict: 'skip', timeoutMs: 50, onTimeout: 'release' });

    // Wait for the timeout to fire
    await new Promise((r) => setTimeout(r, 80));

    // Lock should be released; a new call should succeed
    const p2 = await guard.run('key', async () => 'after-timeout', { onConflict: 'skip' });
    expect(p2).toBe('after-timeout');
    expect(guard.isHeld('key')).toBe(false);

    // The first task's promise still resolves eventually (we don't cancel it)
    expect(await p1).toBe('slow');
  });

  it('timeout with onTimeout error throws GuardTimeoutError', async () => {
    const guard = new Guard();
    const slowFn = () => new Promise<string>((r) => setTimeout(() => r('slow'), 200));

    const p = guard.run('key', slowFn, { onConflict: 'skip', timeoutMs: 50, onTimeout: 'error' });

    await expect(p).rejects.toThrow(GuardTimeoutError);
    expect(guard.isHeld('key')).toBe(false);
  });

  it('isHeld returns true while held, false after release', async () => {
    const guard = new Guard();

    const p = guard.run('key', async () => {
      expect(guard.isHeld('key')).toBe(true);
      return 'done';
    }, { onConflict: 'skip' });

    expect(guard.isHeld('key')).toBe(true);
    await p;
    expect(guard.isHeld('key')).toBe(false);
  });

  it('if fn throws, lock is released', async () => {
    const guard = new Guard();

    await expect(guard.run('key', async () => {
      throw new Error('boom');
    }, { onConflict: 'skip' })).rejects.toThrow('boom');

    expect(guard.isHeld('key')).toBe(false);

    // Next call should succeed
    const result = await guard.run('key', async () => 'recovered', { onConflict: 'skip' });
    expect(result).toBe('recovered');
  });
});
