/**
 * auth 消费方注入式凭据 seam（Plan 3 Task 5）——核心不再 import runtime/auth，
 * 凭据解析单点收敛到 index.ts 接线（active runtime credentials → legacy auth.json → null）。
 * 本测试钉各消费方的注入路径行为。
 */
import { createMediaPluginContext } from '../../../src/media/plugin-context';
import { createPluginContext as createUsageContext, makeAdapter } from '../../../src/usage/plugin-context';

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

describe('��������·�����ߣ����� #6������ #1/#2 ��ع飩', () => {
  it('makeAdapter��ע�� getApiKey �� ��� ctx.apiKey ���usage �����������·��', async () => {
    const seen: Array<{ name: string; key: string | null }> = [];
    const mod = {
      name: 'test-provider',
      type: 'api',
      async fetch(ctx: any) {
        seen.push({ name: 'test-provider', key: ctx.apiKey('test-provider') });
        return { name: 'test-provider', type: 'api', windows: [{ window: 'balance', used: 1, limit: 10, unit: '$', pct: 10 }] };
      },
    };
    const adapter = makeAdapter(mod, 'test-provider.js', undefined, undefined, (p) => (p === 'test-provider' ? 'sk-wired' : null));
    const result = await adapter.fetch();
    expect(result).toBeTruthy();
    expect(seen[0].key).toBe('sk-wired'); // ������·��getApiKey �� makeAdapter �� createPluginContext �� ctx.apiKey
  });

  it('makeAdapter���� getApiKey �� ctx.apiKey null��fail-open ��ը��������д�����', async () => {
    let got: string | null | undefined;
    const mod = {
      name: 'x', type: 'api',
      async fetch(ctx: any) { got = ctx.apiKey('x'); return null; },
    };
    const adapter = makeAdapter(mod, 'x.js');
    expect(await adapter.fetch()).toBeNull();
    expect(got).toBeNull();
  });

  it('initEmbeddingRuntime��ע�� getApiKeyFn �� provider �õ� key��DashScope Ƕ����·��', async () => {
    const { initEmbeddingRuntime } = await import('../../../src/memory/embedding-runtime');
    const keys: string[] = [];
    const runtime = await initEmbeddingRuntime({
      baseDir: 'C:/tmp/test-embed-' + Date.now(),
      cfg: { provider: 'dashscope', model: 'test-model', dimensions: 3 },
      getApiKeyFn: (p) => { keys.push(p); return p === 'alibaba-cn' ? 'sk-embed' : null; },
      createProviderFn: ((cfg: any) => ({
        provider: 'dashscope',
        name: 'dashscope-test-model',
        dims: 3,
        async embed() { return [[1, 2, 3]]; },
        get apiKey() { return cfg.getApiKeyFn?.('alibaba-cn') ?? null; },
      })) as any,
    });
    expect(runtime).toBeTruthy();
    expect((runtime!.provider as any).apiKey).toBe('sk-embed');
    expect(keys).toContain('alibaba-cn');
  });
});
