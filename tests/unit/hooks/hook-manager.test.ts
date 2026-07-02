import { HookManager, HookRegistration } from '../../../src/hooks/hook-manager';

describe('HookManager', () => {
  let manager: HookManager;

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    manager = new HookManager({ failBehavior: 'continue', timeout: 5000 });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('register and execute hooks', async () => {
    const executed: string[] = [];
    manager.register({
      name: 'test-hook',
      event: 'test.event',
      handler: async (ctx) => { executed.push(ctx.event); },
      priority: 10
    });

    await manager.execute('test.event', {});

    expect(executed).toEqual(['test.event']);
  });

  test('priority ordering (lower number runs first)', async () => {
    const order: number[] = [];
    manager.register({
      name: 'high-priority',
      event: 'test.event',
      handler: async () => { order.push(1); },
      priority: 10
    });
    manager.register({
      name: 'low-priority',
      event: 'test.event',
      handler: async () => { order.push(2); },
      priority: 100
    });
    manager.register({
      name: 'mid-priority',
      event: 'test.event',
      handler: async () => { order.push(3); },
      priority: 50
    });

    await manager.execute('test.event', {});

    expect(order).toEqual([1, 3, 2]);
  });

  test('timeout kills slow hooks', async () => {
    manager = new HookManager({ failBehavior: 'continue', timeout: 50 });
    const executed: string[] = [];
    manager.register({
      name: 'fast-hook',
      event: 'test.event',
      handler: async () => { executed.push('fast'); },
      priority: 10
    });
    manager.register({
      name: 'slow-hook',
      event: 'test.event',
      handler: async () => { await new Promise(r => setTimeout(r, 500)); executed.push('slow'); },
      priority: 20
    });
    manager.register({
      name: 'next-hook',
      event: 'test.event',
      handler: async () => { executed.push('next'); },
      priority: 30
    });

    await manager.execute('test.event', {});

    expect(executed).toEqual(['fast', 'next']);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Hook "slow-hook" failed: Hook "slow-hook" timed out after 50ms')
    );
  });

  test('failBehavior: continue — one hook fails, next still runs', async () => {
    manager = new HookManager({ failBehavior: 'continue', timeout: 5000 });
    const executed: string[] = [];
    manager.register({
      name: 'failing-hook',
      event: 'test.event',
      handler: async () => { throw new Error('oops'); },
      priority: 10
    });
    manager.register({
      name: 'next-hook',
      event: 'test.event',
      handler: async () => { executed.push('next'); },
      priority: 20
    });

    await manager.execute('test.event', {});

    expect(executed).toEqual(['next']);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Hook "failing-hook" failed: oops')
    );
  });

  test('failBehavior: stop — first failure stops execution', async () => {
    manager = new HookManager({ failBehavior: 'stop', timeout: 5000 });
    const executed: string[] = [];
    manager.register({
      name: 'failing-hook',
      event: 'test.event',
      handler: async () => { throw new Error('oops'); },
      priority: 10
    });
    manager.register({
      name: 'next-hook',
      event: 'test.event',
      handler: async () => { executed.push('next'); },
      priority: 20
    });

    await expect(manager.execute('test.event', {})).rejects.toThrow('oops');
    expect(executed).toEqual([]);
  });

  test('unregister removes hook', async () => {
    const executed: string[] = [];
    manager.register({
      name: 'to-remove',
      event: 'test.event',
      handler: async () => { executed.push('removed'); },
      priority: 10
    });

    const result = manager.unregister('to-remove');
    expect(result).toBe(true);

    await manager.execute('test.event', {});
    expect(executed).toEqual([]);
  });

  test('unregister returns false for non-existent hook', () => {
    expect(manager.unregister('non-existent')).toBe(false);
  });

  test('clear removes all hooks', async () => {
    manager.register({
      name: 'hook-a',
      event: 'event.a',
      handler: async () => {},
      priority: 10
    });
    manager.register({
      name: 'hook-b',
      event: 'event.b',
      handler: async () => {},
      priority: 10
    });

    expect(manager.size()).toBe(2);

    manager.clear();

    expect(manager.size()).toBe(0);
    await manager.execute('event.a', {});
  });

  test('getHooks returns all hooks when no event specified', () => {
    manager.register({ name: 'a', event: 'e1', handler: async () => {}, priority: 10 });
    manager.register({ name: 'b', event: 'e2', handler: async () => {}, priority: 20 });

    const all = manager.getHooks();
    expect(all).toHaveLength(2);
    expect(all.map(h => h.name)).toEqual(['a', 'b']);
  });

  test('getHooks filters by event', () => {
    manager.register({ name: 'a', event: 'e1', handler: async () => {}, priority: 10 });
    manager.register({ name: 'b', event: 'e2', handler: async () => {}, priority: 20 });

    const filtered = manager.getHooks('e1');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe('a');
  });

  test('getHooks returns empty array for non-existent event', () => {
    expect(manager.getHooks('non-existent')).toEqual([]);
  });

  test('empty event returns without error', async () => {
    await expect(manager.execute('non-existent', {})).resolves.toBeUndefined();
  });

  test('registerMany bulk registers', () => {
    const hooks: HookRegistration[] = [
      { name: 'a', event: 'e1', handler: async () => {}, priority: 10 },
      { name: 'b', event: 'e2', handler: async () => {}, priority: 20 }
    ];
    manager.registerMany(hooks);

    expect(manager.size()).toBe(2);
  });

  test('size returns correct count', () => {
    expect(manager.size()).toBe(0);
    manager.register({ name: 'a', event: 'e1', handler: async () => {}, priority: 10 });
    expect(manager.size()).toBe(1);
    manager.register({ name: 'b', event: 'e1', handler: async () => {}, priority: 20 });
    expect(manager.size()).toBe(2);
  });
});
