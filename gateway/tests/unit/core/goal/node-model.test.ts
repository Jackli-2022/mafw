// gateway/tests/unit/core/goal/node-model.test.ts
// W1/W5a：goal 节点模型解析——配置覆盖优先，身份内置兜底，空对=回落。
import { resolveNodeModel } from '../../../../src/core/goal/node-model';

describe('resolveNodeModel', () => {
  const identity = { providerID: 'gateway', modelID: 'volcengine/deepseek-v4.1-flash' };
  it('配置覆盖优先', () => {
    expect(resolveNodeModel(identity, { providerID: 'opencode-go', modelID: 'deepseek-v4.1-flash' }))
      .toEqual({ providerID: 'opencode-go', modelID: 'deepseek-v4.1-flash' });
  });
  it('配置为空/缺省 → 身份兜底', () => {
    expect(resolveNodeModel(identity, undefined)).toEqual(identity);
    expect(resolveNodeModel(identity, null as any)).toEqual(identity);
    expect(resolveNodeModel(identity, { providerID: '', modelID: '' })).toEqual(identity);
  });
  it('身份也缺省 → null（runtime 默认模型）', () => {
    expect(resolveNodeModel(undefined, undefined)).toBeNull();
    expect(resolveNodeModel(null as any, { providerID: '', modelID: '' })).toBeNull();
  });
  it('配置半空对（只有 provider）→ 回落身份（不半用）', () => {
    expect(resolveNodeModel(identity, { providerID: 'opencode-go', modelID: '' })).toEqual(identity);
  });
});
