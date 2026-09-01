/**
 * EmbeddingProvider (P1a): provider interface + DashScope HTTP impl +
 * local ONNX impl scaffolding + URL/key resolution.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  EmbeddingProvider,
  createEmbeddingProvider,
  resolveEmbeddingBaseUrl,
  buildQueryInput,
} from '../../src/memory/embedding-provider';

function tmpAuthJson(key: string | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-emb-'));
  const p = path.join(dir, 'auth.json');
  const body: any = {};
  if (key !== null) {
    body['alibaba-cn'] = { type: 'api', key };
  }
  fs.writeFileSync(p, JSON.stringify(body), 'utf-8');
  return p;
}

describe('resolveEmbeddingBaseUrl', () => {
  test('maps alibaba providers to dashscope compatible-mode embedding endpoint', () => {
    expect(resolveEmbeddingBaseUrl('alibaba-cn')).toBe(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings',
    );
    expect(resolveEmbeddingBaseUrl('dashscope')).toBeDefined();
    expect(resolveEmbeddingBaseUrl('qwen')).toBeDefined();
  });

  test('returns undefined for unknown / self-hosted providers', () => {
    expect(resolveEmbeddingBaseUrl('gateway')).toBeUndefined();
    expect(resolveEmbeddingBaseUrl(undefined)).toBeUndefined();
  });
});

describe('createEmbeddingProvider', () => {
  test('provider off → null', () => {
    expect(createEmbeddingProvider({ provider: 'off' })).toBeNull();
  });

  test('unknown provider → null', () => {
    expect(createEmbeddingProvider({ provider: 'wat' as any })).toBeNull();
  });
});

describe('DashScopeEmbeddingProvider', () => {
  const baseCfg = {
    provider: 'dashscope' as const,
    model: 'text-embedding-v4',
    dimensions: 1024,
  };

  function okResponse(texts: string[]) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: texts.map((t, i) => ({
          index: i,
          embedding: [0.1 * (i + 1), 0.2],
        })),
        usage: { total_tokens: 10 },
      }),
    };
  }

  test('embeds documents via openai-compatible endpoint', async () => {
    const calls: any[] = [];
    const fetchFn = (async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      return okResponse(['a', 'b']);
    }) as any;

    const provider = createEmbeddingProvider({
      ...baseCfg,
      apiKey: 'sk-test',
      fetchFn,
    }) as EmbeddingProvider;

    const vectors = await provider.embed(['a', 'b'], 'document');

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/compatible-mode/v1/embeddings');
    expect(calls[0].init.headers.Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(calls[0].init.body);
    expect(body.model).toBe('text-embedding-v4');
    expect(body.input).toEqual(['a', 'b']);
    expect(body.dimensions).toBe(1024);
    expect(vectors).toEqual([
      [0.1, 0.2],
      [0.2, 0.2],
    ]);
  });

  test('query kind reorders by index', async () => {
    const calls: any[] = [];
    const fetchFn = (async (_url: any, init: any) => {
      calls.push({ init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { index: 1, embedding: [2, 2] },
            { index: 0, embedding: [1, 1] },
          ],
        }),
      };
    }) as any;

    const provider = createEmbeddingProvider({ ...baseCfg, apiKey: 'k', fetchFn }) as EmbeddingProvider;
    const vectors = await provider.embed(['q1', 'q2'], 'query');

    expect(vectors).toEqual([
      [1, 1],
      [2, 2],
    ]);
  });

  test('resolves API key from credentials when not explicit', async () => {
    const calls: any[] = [];
    const fetchFn = (async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      return okResponse(['x']);
    }) as any;

    const provider = createEmbeddingProvider({
      ...baseCfg,
      fetchFn,
      credentials: { getApiKey: (p: string) => (p === 'alibaba-cn' ? 'sk-cred' : null) },
    }) as EmbeddingProvider;

    await provider.embed(['x'], 'document');
    expect(calls[0].init.headers.Authorization).toBe('Bearer sk-cred');
  });

  test('falls back to auth.json at authPath', async () => {
    const authPath = tmpAuthJson('sk-file');
    const calls: any[] = [];
    const fetchFn = (async (url: any, init: any) => {
      calls.push({ init });
      return okResponse(['x']);
    }) as any;

    const provider = createEmbeddingProvider({
      ...baseCfg,
      fetchFn,
      authPath,
    }) as EmbeddingProvider;

    await provider.embed(['x'], 'document');
    expect(calls[0].init.headers.Authorization).toBe('Bearer sk-file');
  });

  test('no key resolvable → throws with clear message', async () => {
    const authPath = tmpAuthJson(null);
    const provider = createEmbeddingProvider({ ...baseCfg, authPath, fetchFn: (async () => { throw new Error('should not fetch'); }) as any }) as EmbeddingProvider;
    await expect(provider.embed(['x'], 'document')).rejects.toThrow(/api key/i);
  });

  test('HTTP failure → throws with status', async () => {
    const fetchFn = (async () => ({ ok: false, status: 429, json: async () => ({}) })) as any;
    const provider = createEmbeddingProvider({ ...baseCfg, apiKey: 'k', fetchFn }) as EmbeddingProvider;
    await expect(provider.embed(['x'], 'document')).rejects.toThrow(/429/);
  });

  test('identical query text is served from cache (no second HTTP call)', async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      return okResponse(['q']);
    }) as any;
    const provider = createEmbeddingProvider({ ...baseCfg, apiKey: 'k', fetchFn }) as EmbeddingProvider;
    await provider.embed(['q'], 'query');
    await provider.embed(['q'], 'query');
    expect(calls).toBe(1);
  });

  test('batching: >10 texts split into multiple requests', async () => {
    const urls: string[] = [];
    const fetchFn = (async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      urls.push(String(_url));
      return okResponse(body.input);
    }) as any;
    const provider = createEmbeddingProvider({ ...baseCfg, apiKey: 'k', fetchFn }) as EmbeddingProvider;
    const texts = Array.from({ length: 23 }, (_, i) => `t${i}`);
    const vectors = await provider.embed(texts, 'document');
    expect(urls.length).toBe(3);
    expect(vectors).toHaveLength(23);
  });
});

describe('LocalEmbeddingProvider (no model download in tests)', () => {
  test('query input carries Instruct prefix, document does not', () => {
    const q = buildQueryInput('favorite food');
    expect(q).toMatch(/^Instruct: .+\nQuery: favorite food$/);
    const d = buildQueryInput('doc text', { asDocument: true });
    expect(d).toBe('doc text');
  });

  test('embeds via injected model with last-token pooling + L2 normalization', async () => {
    const tokenizerInputs: any[] = [];
    const H = 4;
    // B=2 rows, L=3; row0 pads at pos2, row1 pads at pos1 → last real tokens differ.
    const mask = [1n, 1n, 0n, 1n, 0n, 0n];
    const hidden = new Float32Array(2 * 3 * H);
    for (let i = 0; i < 2 * 3 * H; i++) hidden[i] = i + 1;
    const modelFactory = async (_model: string) => ({
      tokenizer: async (texts: string[]) => {
        tokenizerInputs.push(texts);
        return { attention_mask: { dims: [2, 3], data: mask } };
      },
      model: async () => ({ last_hidden_state: { dims: [2, 3, H], data: hidden } }),
    });

    const provider = createEmbeddingProvider({
      provider: 'local',
      model: 'onnx-community/Qwen3-Embedding-0.6B-ONNX',
      dimensions: 1024,
      localDeps: { modelFactory },
    }) as EmbeddingProvider;

    const vectors = await provider.embed(['hello world', 'q2'], 'query');

    // Query inputs carry the Instruct prefix; document inputs are verbatim.
    expect(tokenizerInputs[0][0]).toMatch(/^Instruct: .+\nQuery: hello world$/);
    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toHaveLength(H);
    // Row 0's last real token is index 1 → hidden[4..7] = [5,6,7,8], normalized.
    const expected = [5, 6, 7, 8];
    const nrm = Math.sqrt(expected.reduce((s, x) => s + x * x, 0));
    vectors[0].forEach((x: number, i: number) => expect(x).toBeCloseTo(expected[i] / nrm, 5));
    // Normalized to unit length
    const len = Math.sqrt(vectors[0].reduce((s: number, x: number) => s + x * x, 0));
    expect(len).toBeCloseTo(1, 5);
  });
});
