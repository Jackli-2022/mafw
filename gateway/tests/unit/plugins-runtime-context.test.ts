import { createRuntimePluginContext } from '../../src/runtime/loader';

describe('createRuntimePluginContext', () => {
  it('携带 projectDir/gatewayPort', () => {
    const ctx = createRuntimePluginContext(undefined, { projectDir: '/proj', gatewayPort: 3000 });
    expect(ctx.projectDir).toBe('/proj');
    expect(ctx.gatewayPort).toBe(3000);
  });

  it('extra 缺省时字段为 undefined（向后兼容）', () => {
    const ctx = createRuntimePluginContext();
    expect(ctx.projectDir).toBeUndefined();
    expect(ctx.gatewayPort).toBeUndefined();
  });
});
