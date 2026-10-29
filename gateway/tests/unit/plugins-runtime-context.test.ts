import { createRuntimePluginContext } from '../../src/runtime/loader';

describe('createRuntimePluginContext', () => {
  it('携带 projectDir/gatewayPort/rootDir', () => {
    const ctx = createRuntimePluginContext(undefined, {
      projectDir: '/proj',
      gatewayPort: 3000,
      rootDir: '/home/u/.mafw/runtime-root',
    });
    expect(ctx.projectDir).toBe('/proj');
    expect(ctx.gatewayPort).toBe(3000);
    expect((ctx as any).rootDir).toBe('/home/u/.mafw/runtime-root');
  });

  it('extra 缺省时字段为 undefined（向后兼容）', () => {
    const ctx = createRuntimePluginContext();
    expect(ctx.projectDir).toBeUndefined();
    expect(ctx.gatewayPort).toBeUndefined();
    expect((ctx as any).rootDir).toBeUndefined();
  });
});
