import { createRegistrationBag } from '../../../src/plugins/registration-bag';

describe('createRegistrationBag', () => {
  it('disposes every registration in LIFO order', async () => {
    const bag = createRegistrationBag();
    const order: string[] = [];
    bag.add('first', () => { order.push('first'); });
    bag.add('second', () => { order.push('second'); });
    bag.effect(() => { order.push('effect'); });

    expect(bag.size).toBe(3);
    const diagnostics = await bag.dispose();

    expect(order).toEqual(['effect', 'second', 'first']);
    expect(diagnostics).toEqual([]);
    expect(bag.size).toBe(0);
    expect(bag.disposed).toBe(true);
  });

  it('is idempotent: repeated dispose never re-runs disposers', async () => {
    const bag = createRegistrationBag();
    let calls = 0;
    bag.add('once', () => { calls += 1; });

    const first = bag.dispose();
    const second = bag.dispose();
    expect(second).toBe(first);

    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual([]);
    expect(b).toEqual([]);

    expect(await bag.dispose()).toEqual([]);
    expect(calls).toBe(1);
  });

  it('continues cleanup after a failed disposer and attaches its registration name', async () => {
    const bag = createRegistrationBag();
    const order: string[] = [];
    bag.add('listener', () => { order.push('listener'); });
    bag.add('broken', () => { throw new Error('boom'); });
    bag.add('watcher', () => { order.push('watcher'); });
    bag.add('ok', () => { order.push('ok'); });

    const diagnostics = await bag.dispose();

    expect(order).toEqual(['ok', 'watcher', 'listener']);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ name: 'broken', message: 'boom' });
    expect(bag.size).toBe(0);
  });

  it('awaits async disposers sequentially in LIFO order', async () => {
    const bag = createRegistrationBag();
    const order: string[] = [];
    bag.add('slow', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push('slow');
    });
    bag.add('fast', async () => { order.push('fast'); });

    const diagnostics = await bag.dispose();

    expect(order).toEqual(['fast', 'slow']);
    expect(diagnostics).toEqual([]);
  });

  it('reports a rejected async disposer and keeps cleaning up', async () => {
    const bag = createRegistrationBag();
    const order: string[] = [];
    bag.add('before', () => { order.push('before'); });
    bag.add('rejects', async () => { throw new Error('async boom'); });
    bag.add('after', async () => { order.push('after'); });

    const diagnostics = await bag.dispose();

    expect(order).toEqual(['after', 'before']);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ name: 'rejects', message: 'async boom' });
  });

  it('names effect disposers by registration order', async () => {
    const bag = createRegistrationBag();
    bag.effect(() => { throw new Error('first effect failed'); });
    bag.effect(() => { throw new Error('second effect failed'); });

    const diagnostics = await bag.dispose();

    expect(diagnostics.map((d) => d.name)).toEqual(['effect#2', 'effect#1']);
    expect(diagnostics.map((d) => d.message)).toEqual(['second effect failed', 'first effect failed']);
  });

  it('runs disposers registered after dispose immediately so nothing leaks', async () => {
    const bag = createRegistrationBag();
    await bag.dispose();

    const ran: string[] = [];
    bag.add('late', () => { ran.push('late'); });

    expect(ran).toEqual(['late']);
    expect(bag.size).toBe(0);
  });

  it('swallows late async disposer rejections', async () => {
    const bag = createRegistrationBag();
    await bag.dispose();

    bag.add('late-async', async () => { throw new Error('late boom'); });
    // Give the rejection a turn to surface; it must never become unhandled.
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(bag.size).toBe(0);
  });

  it('rejects a non-function disposer', () => {
    const bag = createRegistrationBag();
    expect(() => bag.add('bad', undefined as any)).toThrow(TypeError);
    expect(() => bag.effect('nope' as any)).toThrow(TypeError);
  });
});
