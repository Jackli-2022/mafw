import { CanonicalObserverRegistry, type CanonicalEvent } from '../../../src/kernel-v2/observer';

const event = (over: Partial<CanonicalEvent> = {}): CanonicalEvent => ({
  type: 'tool.updated',
  sessionID: 's1',
  at: Date.now(),
  properties: { tool: 'x' },
  ...over,
});

describe('CanonicalObserverRegistry', () => {
  test('dispatch is non-blocking and observers receive the event after drain', async () => {
    const seen: string[] = [];
    const registry = new CanonicalObserverRegistry();
    registry.register({
      id: 'a',
      onEvent: (e) => {
        seen.push(e.type);
      },
    });
    const start = Date.now();
    for (let i = 0; i < 1000; i += 1) registry.dispatch(event());
    expect(Date.now() - start).toBeLessThan(100);
    expect(seen).toEqual([]);
    await registry.drain();
    expect(seen).toHaveLength(1000);
  });

  test('filters by session, project and exact/prefix type', async () => {
    const seen: string[] = [];
    const registry = new CanonicalObserverRegistry();
    registry.register({
      id: 'a',
      filter: { sessionID: 's1', types: ['tool.*'] },
      onEvent: (e) => {
        seen.push(e.type);
      },
    });
    registry.dispatch(event({ sessionID: 's2', type: 'tool.updated' }));
    registry.dispatch(event({ type: 'message.updated' }));
    registry.dispatch(event({ type: 'tool.completed' }));
    await registry.drain();
    expect(seen).toEqual(['tool.completed']);
  });

  test('a throwing observer does not block another observer', async () => {
    const seen: string[] = [];
    const registry = new CanonicalObserverRegistry();
    registry.register({
      id: 'bad',
      onEvent: () => {
        throw new Error('boom');
      },
    });
    registry.register({
      id: 'good',
      onEvent: () => {
        seen.push('good');
      },
    });
    registry.dispatch(event());
    await registry.drain();
    expect(seen).toEqual(['good']);
    expect(registry.diagnostics().find((d) => d.observerId === 'bad')?.failed).toBe(1);
  });

  test('a rejecting observer is isolated', async () => {
    const registry = new CanonicalObserverRegistry();
    registry.register({
      id: 'bad',
      onEvent: async () => {
        throw new Error('nope');
      },
    });
    registry.dispatch(event());
    await registry.drain();
    expect(registry.diagnostics()[0]).toMatchObject({
      observerId: 'bad',
      failed: 1,
      lastError: 'nope',
    });
  });

  test('a slow observer times out without blocking drain forever', async () => {
    const registry = new CanonicalObserverRegistry({ defaultTimeoutMs: 20 });
    registry.register({ id: 'slow', onEvent: () => new Promise<void>(() => {}) });
    registry.dispatch(event());
    await expect(registry.drain()).resolves.toBeUndefined();
    expect(registry.diagnostics()[0]).toMatchObject({ observerId: 'slow', timedOut: 1 });
  });

  test('queue overflow drops the newest and counts it', async () => {
    const registry = new CanonicalObserverRegistry({ maxQueue: 2, defaultTimeoutMs: 1000 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen: number[] = [];
    registry.register({
      id: 'a',
      onEvent: async (e) => {
        seen.push(e.at);
        await gate;
      },
    });
    registry.dispatch(event({ at: 1 }));
    registry.dispatch(event({ at: 2 }));
    registry.dispatch(event({ at: 3 }));
    expect(registry.dropped()).toBe(1);
    release();
    await registry.drain();
    expect(seen).toEqual([1, 2]);
  });

  test('dispose stops delivery and calls observer dispose once', async () => {
    let disposed = 0;
    const seen: string[] = [];
    const registry = new CanonicalObserverRegistry();
    registry.register({
      id: 'a',
      onEvent: () => {
        seen.push('x');
      },
      dispose: () => {
        disposed += 1;
      },
    });
    await registry.dispose();
    registry.dispatch(event());
    await registry.drain();
    expect(seen).toEqual([]);
    expect(disposed).toBe(1);
  });
});
