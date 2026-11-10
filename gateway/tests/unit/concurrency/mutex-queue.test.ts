import { MutexQueue } from '../../../src/concurrency/mutex-queue';

describe('MutexQueue', () => {
  it('same-key calls execute sequentially (FIFO)', async () => {
    const mq = new MutexQueue();
    const order: number[] = [];

    await Promise.all([
      mq.run('key', async () => {
        await new Promise((r) => setTimeout(r, 50));
        order.push(1);
      }),
      mq.run('key', async () => {
        order.push(2);
      }),
      mq.run('key', async () => {
        order.push(3);
      }),
    ]);

    expect(order).toEqual([1, 2, 3]);
  });

  it('different keys execute in parallel', async () => {
    const mq = new MutexQueue();
    let concurrent = 0;
    let maxConcurrent = 0;

    const task = async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 40));
      concurrent--;
    };

    await Promise.all([
      mq.run('key1', task),
      mq.run('key2', task),
    ]);

    expect(maxConcurrent).toBe(2);
  });

  it('queued tasks start in submission order, not completion order', async () => {
    const mq = new MutexQueue();
    const started: string[] = [];

    // A is slow, B and C are fast but queued behind A
    const pA = mq.run('key', async () => {
      started.push('A');
      await new Promise((r) => setTimeout(r, 60));
    });
    const pB = mq.run('key', async () => {
      started.push('B');
      await new Promise((r) => setTimeout(r, 10));
    });
    const pC = mq.run('key', async () => {
      started.push('C');
    });

    await Promise.all([pA, pB, pC]);
    expect(started).toEqual(['A', 'B', 'C']);
  });

  it('if fn throws synchronously, next queued task still runs (I1)', async () => {
    const mq = new MutexQueue();
    const results: string[] = [];

    // fn is NOT async — it throws synchronously before returning a promise
    const syncThrow = () => { throw new Error('sync fail'); };

    const p1 = mq.run('key', syncThrow as unknown as () => Promise<void>)
      .catch(() => results.push('caught-1'));

    const p2 = mq.run('key', async () => {
      results.push('task-2-ran');
    });

    await Promise.all([p1, p2]);
    // queueMicrotask(finish) fires before .catch handler → task-2-ran first
    expect(results).toEqual(['task-2-ran', 'caught-1']);
  });

  it('queueLength returns pending count for a key', async () => {
    const mq = new MutexQueue();
    const slow = () => new Promise<void>((r) => setTimeout(r, 60));

    const p1 = mq.run('key', slow);
    const p2 = mq.run('key', slow);
    const p3 = mq.run('key', slow);

    // p1 is running, p2 and p3 are queued
    expect(mq.queueLength('key')).toBe(2);
    expect(mq.queueLength('other')).toBe(0);

    await Promise.all([p1, p2, p3]);
    expect(mq.queueLength('key')).toBe(0);
  });

  it('has() is false for unknown keys, true while running or queued (B2 Task 2)', async () => {
    const mq = new MutexQueue();
    // MutexQueue releases the key in a queueMicrotask AFTER the task's promise
    // settles — flush one microtask turn before asserting "released".
    const flush = () => new Promise<void>((r) => queueMicrotask(() => queueMicrotask(r)));
    expect(mq.has('k')).toBe(false);
    let release!: () => void;
    let release2!: () => void;
    const blocked = new Promise<void>((r) => { release = r; });
    const blocked2 = new Promise<void>((r) => { release2 = r; });
    const p1 = mq.run('k', () => blocked);
    expect(mq.has('k')).toBe(true); // running
    const p2 = mq.run('k', () => blocked2);
    expect(mq.has('k')).toBe(true); // running + queued
    release();
    await p1;
    await flush();
    // p2 now running (still blocked)
    expect(mq.has('k')).toBe(true);
    release2();
    await p2;
    await flush();
    expect(mq.has('k')).toBe(false);
  });

  it('has() is independent per key', async () => {
    const mq = new MutexQueue();
    const flush = () => new Promise<void>((r) => queueMicrotask(() => queueMicrotask(r)));
    let releaseA!: () => void;
    const blockedA = new Promise<void>((r) => { releaseA = r; });
    const pa = mq.run('a', () => blockedA);
    expect(mq.has('a')).toBe(true);
    expect(mq.has('b')).toBe(false);
    const pb = await mq.run('b', async () => 'b-done');
    expect(pb).toBe('b-done');
    await flush();
    expect(mq.has('b')).toBe(false); // b settled — a's state is independent
    expect(mq.has('a')).toBe(true);
    releaseA();
    await pa;
    await flush();
    expect(mq.has('a')).toBe(false);
  });
});
