/**
 * auth 消费方注入式凭据 seam（Plan 3 Task 5）——核心不再 import runtime/auth，
 * 凭据解析单点收敛到 index.ts 接线（active runtime credentials → legacy auth.json → null）。
 * 本测试钉各消费方的注入路径行为。
 */
import { createMediaPluginContext } from '../../../src/media/plugin-context';
import { createPluginContext as createUsageContext } from '../../../src/usage/plugin-context';

describe('注入式凭据 seam（消费方只见 getApiKey 动词）', () => {
  it('media ctx：注入 getApiKey → ctx.apiKey 原样到达（不再 import auth.ts）', () => {
    const ctx = createMediaPluginContext('demo', (name) => (name === 'xiaomi' ? 'k-xiaomi' : null));
    expect(ctx.apiKey('xiaomi')).toBe('k-xiaomi');
    expect(ctx.apiKey('other')).toBeNull();
  });

  it('media ctx：缺省注入 → 恒 null（fail-open，不静默回退 auth.json）', () => {
    const ctx = createMediaPluginContext('demo');
    expect(ctx.apiKey('anything')).toBeNull();
  });

  it('usage ctx：注入 getApiKey 优先，inlineApiKey 兜底（既有语义保持）', () => {
    const ctx = createUsageContext('kimi', (name) => (name === 'kimi' ? 'k1' : null), undefined, 'inline-k');
    expect(ctx.apiKey('kimi')).toBe('k1');
    // 注入未覆盖的插件名：inlineApiKey 兜底（插件自身名匹配时）
    const ctx2 = createUsageContext('kimi', () => null, undefined, 'inline-k');
    expect(ctx2.apiKey('kimi')).toBe('inline-k');
    expect(ctx2.apiKey('other')).toBeNull();
  });

  it('usage ctx：缺省注入 + 无 inline → null', () => {
    const ctx = createUsageContext('x');
    expect(ctx.apiKey('x')).toBeNull();
  });
});
