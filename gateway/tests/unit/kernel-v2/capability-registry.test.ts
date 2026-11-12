import { CapabilityRegistry } from '../../../src/kernel-v2/capability-registry';

type Value = { label: string };

function entry(id: string, label = id, dispose?: () => void | Promise<void>) {
  return { id, value: { label }, dispose };
}

describe('CapabilityRegistry', () => {
  test('resolves a provider registered at the requested id', () => {
    const reg = new CapabilityRegistry<Value>({ defaultId: 'default' });
    reg.register('builtin', entry('alpha'));
    expect(reg.resolve('alpha').label).toBe('alpha');
  });

  test('resolves the default provider when no id is given', () => {
    const reg = new CapabilityRegistry<Value>({ defaultId: 'default' });
    reg.register('builtin', entry('default'));
    expect(reg.resolve().label).toBe('default');
  });

  test('empty id behaves as default without a fallback warning', () => {
    const onFallback = jest.fn();
    const reg = new CapabilityRegistry<Value>({ defaultId: 'default', onFallback });
    reg.register('builtin', entry('default'));
    expect(reg.resolve('').label).toBe('default');
    expect(onFallback).not.toHaveBeenCalled();
  });

  test('prefers package over legacy over builtin for the same id', () => {
    const reg = new CapabilityRegistry<Value>({ defaultId: 'default' });
    reg.register('builtin', entry('same', 'builtin'));
    reg.register('legacy', entry('same', 'legacy'));
    expect(reg.resolve('same').label).toBe('legacy');
    reg.register('package', entry('same', 'package'));
    expect(reg.resolve('same').label).toBe('package');
  });

  test('unknown id falls back to the default and reports it once', () => {
    const onFallback = jest.fn();
    const reg = new CapabilityRegistry<Value>({ defaultId: 'default', onFallback });
    reg.register('builtin', entry('default'));
    expect(reg.resolve('missing').label).toBe('default');
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledWith('missing', 'default');
  });

  test('fallback uses the highest tier of the default id', () => {
    const reg = new CapabilityRegistry<Value>({ defaultId: 'default' });
    reg.register('builtin', entry('default', 'builtin-default'));
    reg.register('package', entry('default', 'package-default'));
    expect(reg.resolve('missing').label).toBe('package-default');
  });

  test('throws a caller-shaped message when neither id nor default exists', () => {
    const reg = new CapabilityRegistry<Value>({
      defaultId: 'default',
      missingMessage: (wanted) => `no provider for ${wanted}`,
    });
    expect(() => reg.resolve('missing')).toThrow('no provider for missing');
  });

  test('same tier and id replaces the previous provider', () => {
    const reg = new CapabilityRegistry<Value>({ defaultId: 'default' });
    reg.register('builtin', entry('same', 'first'));
    reg.register('builtin', entry('same', 'second'));
    expect(reg.resolve('same').label).toBe('second');
  });

  test('replacing an entry only tracks the latest registration for disposal', async () => {
    const calls: string[] = [];
    const reg = new CapabilityRegistry<Value>({ defaultId: 'default' });
    reg.register('builtin', entry('same', 'old', () => { calls.push('old'); }));
    reg.register('builtin', entry('same', 'new', () => { calls.push('new'); }));
    await reg.dispose();
    expect(calls).toEqual(['new']);
  });

  test('replaceTier drops stale ids without touching other tiers', () => {
    const reg = new CapabilityRegistry<Value>({ defaultId: 'default' });
    reg.register('builtin', entry('builtin'));
    reg.register('legacy', entry('old-legacy'));
    reg.replaceTier('legacy', [entry('new-legacy')]);
    expect(reg.get('old-legacy')).toBeUndefined();
    expect(reg.get('new-legacy')?.label).toBe('new-legacy');
    expect(reg.get('builtin')?.label).toBe('builtin');
  });

  test('list dedupes by id with the highest tier as source and preserves first-seen order', () => {
    const reg = new CapabilityRegistry<Value>({ defaultId: 'default' });
    reg.register('builtin', entry('a', 'a-builtin'));
    reg.register('builtin', entry('b', 'b-builtin'));
    reg.register('legacy', entry('b', 'b-legacy'));
    reg.register('legacy', entry('c', 'c-legacy'));
    reg.register('package', entry('a', 'a-package'));
    expect(reg.list()).toEqual([
      { id: 'a', value: { label: 'a-package' }, tier: 'package', scope: { kind: 'global' } },
      { id: 'b', value: { label: 'b-legacy' }, tier: 'legacy', scope: { kind: 'global' } },
      { id: 'c', value: { label: 'c-legacy' }, tier: 'legacy', scope: { kind: 'global' } },
    ]);
  });

  test('dispose runs disposers in LIFO order and isolates failures', async () => {
    const calls: string[] = [];
    const reg = new CapabilityRegistry<Value>({ defaultId: 'default' });
    reg.register('builtin', entry('a', 'a', () => { calls.push('a'); }));
    reg.register('builtin', entry('b', 'b', () => { calls.push('b'); throw new Error('boom'); }));
    const diagnostics = await reg.dispose();
    expect(calls).toEqual(['b', 'a']);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].id).toBe('b');
    expect(diagnostics[0].message).toContain('boom');
  });

  test('dispose is idempotent and closes resolve/register', async () => {
    const reg = new CapabilityRegistry<Value>({ defaultId: 'default' });
    reg.register('builtin', entry('default'));
    await reg.dispose();
    await expect(reg.dispose()).resolves.toEqual([]);
    expect(() => reg.resolve()).toThrow(/disposed/);
    expect(() => reg.register('builtin', entry('late'))).toThrow(/disposed/);
  });
});
