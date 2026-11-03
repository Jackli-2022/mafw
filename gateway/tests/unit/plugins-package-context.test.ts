import { config } from '../../src/config';
import { createPluginPackageContext } from '../../src/plugins/package-context';
import { createRegistrationBag } from '../../src/plugins/registration-bag';

describe('createPluginPackageContext', () => {
  // config.raw 是只读 getter（返回 this.data）——测试直接换 data 对象再还原
  const savedData = (config as any).data;
  afterEach(() => { (config as any).data = savedData; });

  it('pluginConfig 优先读 plugins.<name>.config', () => {
    (config as any).data = { plugins: { foo: { config: { a: 1 } } }, usage: { pluginConfig: { foo: { a: 2 } } } };
    const ctx = createPluginPackageContext('foo', { projectDir: '/p', gatewayPort: 3000 });
    expect(ctx.pluginConfig()).toEqual({ a: 1 });
  });

  it('pluginConfig 回退 legacy usage→media→runtime 三段', () => {
    (config as any).data = { media: { pluginConfig: { foo: { b: 2 } } } };
    const ctx = createPluginPackageContext('foo', { projectDir: '/p', gatewayPort: 3000 });
    expect(ctx.pluginConfig()).toEqual({ b: 2 });
  });

  it('pluginConfig 全缺省时返回 {}', () => {
    (config as any).data = {};
    const ctx = createPluginPackageContext('foo', { projectDir: '/p', gatewayPort: 3000 });
    expect(ctx.pluginConfig()).toEqual({});
  });

  it('携带 projectDir/gatewayPort；usageStats 缺省返回空', () => {
    (config as any).data = {};
    const ctx = createPluginPackageContext('foo', { projectDir: '/p', gatewayPort: 3000 });
    expect(ctx.projectDir).toBe('/p');
    expect(ctx.gatewayPort).toBe(3000);
    expect(ctx.usage.modelStats()).toEqual([]);
  });

  it('usageStats thunk 惰性求值', () => {
    (config as any).data = {};
    const ctx = createPluginPackageContext('foo', {
      projectDir: '/p', gatewayPort: 3000,
      usageStats: () => ({ modelStats: () => [{ provider: 'p', model: 'm' }] as any }),
    });
    expect(ctx.usage.modelStats()).toHaveLength(1);
  });

  it('emit 缺省 no-op（不炸）', () => {
    (config as any).data = {};
    const ctx = createPluginPackageContext('foo', { projectDir: '/p', gatewayPort: 3000 });
    expect(() => ctx.emit({ type: 'plugin:foo:x' })).not.toThrow();
  });

  it('emit 经 deps.thunk 透传到 gateway 广播', () => {
    (config as any).data = {};
    const seen: any[] = [];
    const ctx = createPluginPackageContext('foo', {
      projectDir: '/p', gatewayPort: 3000,
      emit: (e) => seen.push(e),
    });
    ctx.emit({ type: 'plugin:foo:x', level: 'warn' });
    expect(seen).toEqual([{ type: 'plugin:foo:x', level: 'warn' }]);
  });

  it('ctx.effect registers cleanups on the host bag and runs them LIFO exactly once', async () => {
    (config as any).data = {};
    const bag = createRegistrationBag();
    const order: string[] = [];
    const ctx = createPluginPackageContext('foo', { projectDir: '/p', gatewayPort: 3000, bag });
    ctx.effect(() => { order.push('first'); });
    ctx.effect(() => { order.push('second'); });
    expect(bag.size).toBe(2);

    await bag.dispose();
    // LIFO: the most recently registered cleanup runs first.
    expect(order).toEqual(['second', 'first']);
    await bag.dispose();
    expect(order).toEqual(['second', 'first']);
  });

  it('ctx.effect throws a clear error when the host has no registration bag', () => {
    (config as any).data = {};
    const ctx = createPluginPackageContext('foo', { projectDir: '/p', gatewayPort: 3000 });
    expect(() => ctx.effect(() => {})).toThrow(/ctx\.effect/);
    expect(() => ctx.effect(() => {})).toThrow(/registration bag/);
  });
});
