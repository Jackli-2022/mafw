import { httpComplete, resolveCompletionBaseUrl } from '../../../src/runtime/completion-http';

jest.mock('../../../src/runtime/auth', () => ({
  getProviderApiKey: () => null,
}));

function okBody(overrides: any = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: 'hello world' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 80 } },
      ...overrides,
    }),
  };
}

describe('resolveCompletionBaseUrl', () => {
  it('maps alibaba/dashscope/qwen providers to dashscope compatible-mode', () => {
    expect(resolveCompletionBaseUrl('alibaba-cn')).toContain('dashscope.aliyuncs.com');
    expect(resolveCompletionBaseUrl('qwen')).toContain('dashscope.aliyuncs.com');
    expect(resolveCompletionBaseUrl('openai')).toBeUndefined();
  });

  it('config endpoints win over the hardcoded table', () => {
    expect(resolveCompletionBaseUrl('alibaba-cn', { 'alibaba-cn': 'https://x.example/v1/chat/completions' }))
      .toBe('https://x.example/v1/chat/completions');
  });
});

describe('httpComplete', () => {
  it('sends cacheable system blocks with cache_control and text-only user as string', async () => {
    const calls: Array<{ url: string; init: any }> = [];
    const fetchFn = (async (url: string, init?: any) => { calls.push({ url, init }); return okBody(); }) as any;
    const res = await httpComplete(
      {
        model: { providerID: 'alibaba-cn', modelID: 'qwen3.7-max' },
        system: [{ text: 'sys' }, { text: '# Memory Index', cacheable: true }],
        user: [{ type: 'text', text: 'my query' }],
        maxTokens: 4096,
        temperature: 0,
      },
      { fetchFn, apiKey: 'sk-test' },
    );
    expect(res.text).toBe('hello world');
    expect(res.usage).toEqual({ input: 20, cached: 80, output: 5 }); // input = prompt - cached
    const body = JSON.parse(calls[0].init.body);
    expect(body.messages[0].content[1].cache_control).toEqual({ type: 'ephemeral' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'my query' });
  });

  it('serializes image parts as OpenAI image_url data URIs', async () => {
    const calls: Array<{ init: any }> = [];
    const fetchFn = (async (_url: string, init?: any) => { calls.push({ init }); return okBody(); }) as any;
    await httpComplete(
      {
        model: { providerID: 'alibaba-cn', modelID: 'qwen3.7-max' },
        user: [
          { type: 'text', text: 'describe' },
          { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
        ],
      },
      { fetchFn, apiKey: 'sk-test' },
    );
    const body = JSON.parse(calls[0].init.body);
    expect(body.messages[0].content).toEqual([
      { type: 'text', text: 'describe' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } },
    ]);
  });

  it('returns undefined usage when provider omits it', async () => {
    const fetchFn = (async () => okBody({ usage: undefined })) as any;
    const res = await httpComplete(
      { model: { providerID: 'alibaba-cn', modelID: 'm' }, user: [{ type: 'text', text: 'q' }] },
      { fetchFn, apiKey: 'sk-test' },
    );
    expect(res.usage).toBeUndefined();
  });

  it('falls back to reasoning_content when content is empty', async () => {
    const fetchFn = (async () => okBody({
      choices: [{ message: { content: '', reasoning_content: 'from reasoning' } }],
    })) as any;
    const res = await httpComplete(
      { model: { providerID: 'alibaba-cn', modelID: 'm' }, user: [{ type: 'text', text: 'q' }] },
      { fetchFn, apiKey: 'sk-test' },
    );
    expect(res.text).toBe('from reasoning');
  });

  it('throws on non-ok HTTP status', async () => {
    const fetchFn = (async () => ({ ok: false, status: 500, text: async () => 'boom' })) as any;
    await expect(httpComplete(
      { model: { providerID: 'alibaba-cn', modelID: 'm' }, user: [{ type: 'text', text: 'q' }] },
      { fetchFn, apiKey: 'sk-test' },
    )).rejects.toThrow('HTTP 500');
  });

  it('throws when endpoint and key are both unresolvable', async () => {
    await expect(httpComplete(
      { model: { providerID: 'unknown-prov', modelID: 'm' }, user: [{ type: 'text', text: 'q' }] },
      {},
    )).rejects.toThrow('no endpoint or API key');
  });
});
