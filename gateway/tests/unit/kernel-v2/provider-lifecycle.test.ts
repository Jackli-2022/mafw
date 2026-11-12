import { ProviderLifecycle, type ProviderHandle } from '../../../src/kernel-v2/provider-lifecycle';

function handle(id: string, over: Partial<ProviderHandle> = {}): ProviderHandle {
  return {
    id,
    load: async () => {},
    activate: async () => {},
    deactivate: async () => {},
    health: async () => 'healthy',
    dispose: async () => {},
    ...over,
  };
}

describe('ProviderLifecycle', () => {
  test('activates dependencies before dependents', async () => {
    const order: string[] = [];
    const lifecycle = new ProviderLifecycle({ required: [], untrustedSupported: true });
    const result = await lifecycle.start([
      handle('a', {
        requires: ['b'],
        load: async () => { order.push('load:a'); },
        activate: async () => { order.push('activate:a'); },
      }),
      handle('b', {
        load: async () => { order.push('load:b'); },
        activate: async () => { order.push('activate:b'); },
      }),
    ]);
    expect(result.failed).toEqual([]);
    expect(order).toEqual(['load:b', 'load:a', 'activate:b', 'activate:a']);
  });

  test('cycle fails closed with a named reason', async () => {
    const lifecycle = new ProviderLifecycle({ required: ['a'], untrustedSupported: true });
    const result = await lifecycle.start([
      handle('a', { requires: ['b'] }),
      handle('b', { requires: ['a'] }),
    ]);
    expect(result.failed.sort()).toEqual(['a', 'b']);
    expect(result.safeMode).toBe(true);
  });

  test('load throw is fail-soft', async () => {
    const lifecycle = new ProviderLifecycle({ required: [], untrustedSupported: true });
    const result = await lifecycle.start([
      handle('bad', { load: async () => { throw new Error('load boom'); } }),
      handle('good'),
    ]);
    expect(result.failed).toEqual(['bad']);
    expect(result.active).toEqual(['good']);
    expect(result.safeMode).toBe(false);
  });

  test('activate timeout fails only that provider', async () => {
    const lifecycle = new ProviderLifecycle({
      required: [],
      untrustedSupported: true,
      timeoutMs: 20,
    });
    const result = await lifecycle.start([
      handle('slow', { activate: () => new Promise<void>(() => {}) }),
      handle('fast'),
    ]);
    expect(result.failed).toEqual(['slow']);
    expect(result.active).toEqual(['fast']);
  });

  test('required failure enters safe mode; optional failure degrades', async () => {
    const required = new ProviderLifecycle({ required: ['core'], untrustedSupported: true });
    const requiredResult = await required.start([
      handle('core', { activate: async () => { throw new Error('no'); } }),
    ]);
    expect(requiredResult.safeMode).toBe(true);

    const optional = new ProviderLifecycle({ required: ['core'], untrustedSupported: true });
    const optionalResult = await optional.start([
      handle('core'),
      handle('extra', { activate: async () => { throw new Error('no'); } }),
    ]);
    expect(optionalResult.safeMode).toBe(false);
    expect(optionalResult.degraded).toContain('extra');
  });

  test('untrusted provider is rejected before load when no worker exists', async () => {
    let loaded = false;
    const lifecycle = new ProviderLifecycle({ required: [], untrustedSupported: false });
    const result = await lifecycle.start([
      handle('untrusted', {
        kind: 'untrusted',
        load: async () => { loaded = true; },
      }),
    ]);
    expect(loaded).toBe(false);
    expect(result.failed).toEqual(['untrusted']);
  });

  test('stop deactivates in reverse order, isolates failures and is idempotent', async () => {
    const order: string[] = [];
    const lifecycle = new ProviderLifecycle({ required: [], untrustedSupported: true });
    await lifecycle.start([
      handle('a', {
        deactivate: async () => { order.push('deactivate:a'); },
        dispose: async () => { order.push('dispose:a'); },
      }),
      handle('b', {
        deactivate: async () => { order.push('deactivate:b'); throw new Error('deactivate boom'); },
        dispose: async () => { order.push('dispose:b'); },
      }),
    ]);
    const diagnostics = await lifecycle.stop();
    expect(order).toEqual(['deactivate:b', 'dispose:b', 'deactivate:a', 'dispose:a']);
    expect(diagnostics.some((item) => item.providerId === 'b' && item.state === 'failed')).toBe(true);
    await expect(lifecycle.stop()).resolves.toEqual([]);
  });

  test('degraded health is reported as degraded', async () => {
    const lifecycle = new ProviderLifecycle({ required: [], untrustedSupported: true });
    const result = await lifecycle.start([
      handle('soft', { health: async () => 'degraded' }),
    ]);
    expect(result.active).toEqual([]);
    expect(result.degraded).toEqual(['soft']);
  });
});
