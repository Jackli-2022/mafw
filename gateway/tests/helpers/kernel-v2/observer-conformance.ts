/**
 * Canonical observer conformance kit.
 *
 * The factory returns a fresh registry. The kit asserts fan-out, filtering,
 * sync/async failure isolation, timeout, bounded queue and dispose.
 */

import type {
  CanonicalEvent,
  CanonicalObserverRegistry,
} from '../../../src/kernel-v2/observer';

export interface ObserverConformanceFactory {
  create(): CanonicalObserverRegistry;
  maxQueue: number;
}

const event = (over: Partial<CanonicalEvent> = {}): CanonicalEvent => ({
  type: 'tool.updated',
  sessionID: 's1',
  at: 1,
  properties: { tool: 'x' },
  ...over,
});

export function runObserverConformance(
  name: string,
  factory: ObserverConformanceFactory,
): void {
  describe(`${name} conformance`, () => {
    test('fans out to every matching observer', async () => {
      const registry = factory.create();
      const seen: string[] = [];
      registry.register({ id: 'a', onEvent: () => seen.push('a') });
      registry.register({ id: 'b', onEvent: () => seen.push('b') });
      registry.dispatch(event());
      await registry.drain();
      expect(seen.sort()).toEqual(['a', 'b']);
      expect(registry.diagnostics().map((d) => d.delivered)).toEqual([1, 1]);
    });

    test('filters by session and type prefix', async () => {
      const registry = factory.create();
      const seen: string[] = [];
      registry.register({
        id: 'a',
        filter: { sessionID: 's1', types: ['tool.*'] },
        onEvent: (e) => seen.push(e.type),
      });
      registry.dispatch(event({ sessionID: 's2' }));
      registry.dispatch(event({ type: 'message.updated' }));
      registry.dispatch(event({ type: 'tool.completed' }));
      await registry.drain();
      expect(seen).toEqual(['tool.completed']);
    });

    test('sync throw and async reject are isolated', async () => {
      const registry = factory.create();
      const seen: string[] = [];
      registry.register({
        id: 'sync-bad',
        onEvent: () => {
          throw new Error('sync boom');
        },
      });
      registry.register({
        id: 'async-bad',
        onEvent: async () => {
          throw new Error('async boom');
        },
      });
      registry.register({ id: 'good', onEvent: () => seen.push('good') });
      registry.dispatch(event());
      await registry.drain();
      expect(seen).toEqual(['good']);
      const diagnostics = registry.diagnostics();
      expect(diagnostics.find((d) => d.observerId === 'sync-bad')?.failed).toBe(1);
      expect(diagnostics.find((d) => d.observerId === 'async-bad')?.failed).toBe(1);
    });

    test('a slow observer times out and does not block drain', async () => {
      const registry = factory.create();
      registry.register({ id: 'slow', onEvent: () => new Promise<void>(() => {}) });
      registry.dispatch(event());
      await expect(registry.drain()).resolves.toBeUndefined();
      expect(registry.diagnostics()[0]?.timedOut).toBe(1);
    });

    test('queue overflow drops the newest and counts it', async () => {
      const registry = factory.create();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      registry.register({ id: 'a', onEvent: async () => gate });
      for (let i = 0; i < factory.maxQueue + 1; i += 1) registry.dispatch(event({ at: i }));
      expect(registry.dropped()).toBe(1);
      release();
      await registry.drain();
    });

    test('dispose stops delivery and calls observer dispose', async () => {
      const registry = factory.create();
      let disposed = 0;
      const seen: string[] = [];
      registry.register({
        id: 'a',
        onEvent: () => seen.push('x'),
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
}
