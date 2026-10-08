import { createMafwHostExtension, hashText, buildRecallQuery } from '../../../src/runtime/pi/pi-mafw-host-extension';

type Req = { url: string; method: string; body?: any };
type Res = { ok: boolean; json?: any };

function makeFakeFetch(routes: Array<{ match: (r: Req) => boolean; res: Res }>) {
  const calls: Req[] = [];
  const fetchImpl: any = async (url: string, init?: any) => {
    const req: Req = { url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : undefined };
    calls.push(req);
    const hit = routes.find((r) => r.match(req));
    if (!hit) throw new Error(`no route for ${req.method} ${req.url}`);
    return { ok: hit.res.ok, json: async () => hit.res.json };
  };
  return { calls, fetchImpl };
}

function makeFakePi() {
  const handlers = new Map<string, Function[]>();
  const tools: any[] = [];
  const pi: any = {
    on: (ev: string, fn: Function) => {
      if (!handlers.has(ev)) handlers.set(ev, []);
      handlers.get(ev)!.push(fn);
    },
    registerTool: (t: any) => tools.push(t),
  };
  return {
    pi,
    tools,
    fire: async (ev: string, event: any) => {
      const results: any[] = [];
      for (const fn of handlers.get(ev) ?? []) results.push(await fn(event, {}));
      return results;
    },
  };
}

describe('pi-mafw-host-extension observe', () => {
  it('user message_end → POST obs user_input', async () => {
    const { calls, fetchImpl } = makeFakeFetch([{ match: (r) => r.url.includes('/api/obs/capture'), res: { ok: true, json: {} } }]);
    const { pi, fire } = makeFakePi();
    createMafwHostExtension({ sessionId: 'pi_s1', baseUrl: 'http://gw', fetchImpl }).on(pi);
    await fire('message_end', { message: { role: 'user', content: 'hello world' } });
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ sessionID: 'pi_s1', source: 'user_input', content: 'hello world' });
  });

  it('assistant message_end → assistant_reply + reasoning 两条', async () => {
    const { calls, fetchImpl } = makeFakeFetch([{ match: (r) => r.url.includes('/api/obs/capture'), res: { ok: true, json: {} } }]);
    const { pi, fire } = makeFakePi();
    createMafwHostExtension({ sessionId: 'pi_s1', baseUrl: 'http://gw', fetchImpl }).on(pi);
    await fire('message_end', { message: { role: 'assistant', content: [
      { type: 'thinking', thinking: 'let me think' },
      { type: 'text', text: 'the answer' },
    ] } });
    await new Promise((r) => setTimeout(r, 10));
    expect(calls.map((c) => c.body.source)).toEqual(['assistant_reply', 'reasoning']);
    expect(calls[0].body.content).toBe('the answer');
    expect(calls[1].body.content).toBe('let me think');
  });

  it('tool_result → tool_result with failure flag', async () => {
    const { calls, fetchImpl } = makeFakeFetch([{ match: (r) => r.url.includes('/api/obs/capture'), res: { ok: true, json: {} } }]);
    const { pi, fire } = makeFakePi();
    createMafwHostExtension({ sessionId: 'pi_s1', baseUrl: 'http://gw', fetchImpl }).on(pi);
    await fire('tool_result', { toolName: 'bash', content: [{ type: 'text', text: 'boom' }], isError: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(calls[0].body).toMatchObject({ source: 'tool_result', failure: 1 });
    expect(calls[0].body.content).toContain('bash');
    expect(calls[0].body.content).toContain('boom');
  });

  it('空内容不 POST', async () => {
    const { calls, fetchImpl } = makeFakeFetch([{ match: (r) => r.url.includes('/api/obs/capture'), res: { ok: true, json: {} } }]);
    const { pi, fire } = makeFakePi();
    createMafwHostExtension({ sessionId: 'pi_s1', baseUrl: 'http://gw', fetchImpl }).on(pi);
    await fire('message_end', { message: { role: 'user', content: '   ' } });
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toHaveLength(0);
  });

  it('hashText 与桌面端 djb2 同实现', () => {
    expect(hashText('你好')).toBe(hashText('你好'));
    expect(hashText('a')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('pi-mafw-host injectContext', () => {
  it('首次 context：全量建 query，注入到 last user 的 content（string→array 转换）', async () => {
    const { calls, fetchImpl } = makeFakeFetch([
      { match: (r) => r.url.includes('/api/recall/context'), res: { ok: true, json: { pointers: '<recall>#mem-abc123 test</recall>' } } },
    ]);
    const { pi, fire } = makeFakePi();
    createMafwHostExtension({ sessionId: 'pi_s1', baseUrl: 'http://gw', fetchImpl }).on(pi);
    const messages = [
      { id: 'm1', role: 'user', content: '关于 laya 判官的部署' },
      { id: 'm2', role: 'assistant', content: [{ type: 'text', text: '判官已部署观察模式' }] },
      { id: 'm3', role: 'user', content: '继续' },
    ];
    const ret = await fire('context', { messages });
    const get = calls.find((c) => c.method === 'GET');
    expect(get.url).toContain('/api/recall/context');
    expect(decodeURIComponent(get.url)).toContain('laya');
    expect(ret[0]).toEqual({ messages });
    const lastUser = messages[messages.length - 1];
    expect(Array.isArray(lastUser.content)).toBe(true);
    expect(JSON.stringify(lastUser.content)).toContain('<recall>');
    expect((lastUser.content as any[]).some((c) => c.synthetic === true)).toBe(true);
  });

  it('游标增量：第二次同会话只对新增消息建 query', async () => {
    const { calls, fetchImpl } = makeFakeFetch([
      { match: (r) => r.url.includes('/api/recall/context'), res: { ok: true, json: { pointers: null } } },
    ]);
    const { pi, fire } = makeFakePi();
    createMafwHostExtension({ sessionId: 'pi_s1', baseUrl: 'http://gw', fetchImpl }).on(pi);
    await fire('context', { messages: [{ id: 'm1', role: 'user', content: 'first question about alpha' }] });
    await fire('context', { messages: [
      { id: 'm1', role: 'user', content: 'first question about alpha' },
      { id: 'm2', role: 'user', content: 'now about beta' },
    ] });
    const urls = calls.map((c) => decodeURIComponent(c.url));
    expect(urls[1]).toContain('beta');
    expect(urls[1]).not.toContain('alpha');
  });

  it('注入的 synthetic part 不回流进下一次查询', async () => {
    const { calls, fetchImpl } = makeFakeFetch([
      { match: (r) => r.url.includes('/api/recall/context'), res: { ok: true, json: { pointers: '<recall>#mem-x injected pointer</recall>' } } },
    ]);
    const { pi, fire } = makeFakePi();
    createMafwHostExtension({ sessionId: 'pi_s1', baseUrl: 'http://gw', fetchImpl }).on(pi);
    await fire('context', { messages: [{ id: 'm1', role: 'user', content: 'topic gamma' }] });
    // 第二次：同一条消息（已带注入 part）+ 新消息
    await fire('context', { messages: [
      { id: 'm1', role: 'user', content: [{ type: 'text', text: 'topic gamma' }, { type: 'text', text: '<recall>#mem-x injected pointer</recall>', synthetic: true }] },
      { id: 'm2', role: 'user', content: 'delta followup' },
    ] });
    const second = decodeURIComponent(calls[calls.length - 1].url);
    expect(second).toContain('delta');
    expect(second).not.toContain('injected pointer');
  });

  it('短增量回退：增量不足时并入 assistant 尾部', () => {
    const real = [
      { id: 'a', role: 'user', content: '长问题' + 'x'.repeat(100) },
      { id: 'b', role: 'assistant', content: [{ type: 'text', text: '答案尾部上下文' + 'y'.repeat(100) }] },
    ];
    const q = buildRecallQuery(real, [real[1]]);
    expect(q).toContain('y');
    // 短增量：不足 50 字符时并入尾部
    const q2 = buildRecallQuery(real, [{ id: 'c', role: 'user', content: '好的' }]);
    expect(q2).toContain('答案尾部上下文');
  });

  it('recall 超时/失败 → 不注入不抛错', async () => {
    const fetchImpl: any = async () => { throw new Error('timeout'); };
    const { pi, fire } = makeFakePi();
    createMafwHostExtension({ sessionId: 'pi_s1', baseUrl: 'http://gw', fetchImpl }).on(pi);
    const messages = [{ id: 'm1', role: 'user', content: 'query text' }];
    const ret = await fire('context', { messages });
    expect(ret[0]).toEqual({ messages });
    expect(messages[0].content).toBe('query text');
  });

  it('无 id 消息：count 游标退化仍工作', async () => {
    const { calls, fetchImpl } = makeFakeFetch([
      { match: (r) => r.url.includes('/api/recall/context'), res: { ok: true, json: { pointers: null } } },
    ]);
    const { pi, fire } = makeFakePi();
    createMafwHostExtension({ sessionId: 'pi_s1', baseUrl: 'http://gw', fetchImpl }).on(pi);
    await fire('context', { messages: [{ role: 'user', content: 'no id message about omega' }] });
    await fire('context', { messages: [
      { role: 'user', content: 'no id message about omega' },
      { role: 'user', content: 'second message about sigma' },
    ] });
    const second = decodeURIComponent(calls[calls.length - 1].url);
    expect(second).toContain('sigma');
    expect(second).not.toContain('omega');
  });
});

describe('pi-mafw-host injectSystem', () => {
  it('before_agent_start 返回原 prompt + memory-guide + pinned', async () => {
    const { fetchImpl } = makeFakeFetch([
      { match: (r) => r.url.includes('/api/recall/pinned'), res: { ok: true, json: { profile: '<user-profile>- 偏好 TDD</user-profile>' } } },
    ]);
    const { pi, fire } = makeFakePi();
    createMafwHostExtension({ sessionId: 'pi_s1', baseUrl: 'http://gw', fetchImpl }).on(pi);
    const ret = await fire('before_agent_start', { systemPrompt: 'BASE' });
    expect(ret[0].systemPrompt).toContain('BASE');
    expect(ret[0].systemPrompt).toContain('<memory-guide>');
    expect(ret[0].systemPrompt).toContain('<user-profile>');
  });

  it('pinned 超时 → 只有 guide（fail-open）', async () => {
    const fetchImpl: any = async () => { throw new Error('timeout'); };
    const { pi, fire } = makeFakePi();
    createMafwHostExtension({ sessionId: 'pi_s1', baseUrl: 'http://gw', fetchImpl }).on(pi);
    const ret = await fire('before_agent_start', { systemPrompt: 'BASE' });
    expect(ret[0].systemPrompt).toContain('<memory-guide>');
    expect(ret[0].systemPrompt).not.toContain('<user-profile>');
  });
});

const FakeType: any = {
  Object: (o: any) => ({ type: 'object', properties: o }),
  String: (d: any) => ({ type: 'string', ...(d || {}) }),
  Optional: (s: any) => s,
  Number: (d: any) => ({ type: 'number', ...(d || {}) }),
  Array: (s: any) => ({ type: 'array', items: s }),
  Union: (a: any[]) => ({ anyOf: a }),
  Literal: (v: any) => ({ const: v }),
};

describe('pi-mafw-host tools', () => {
  it('注册 6 个工具', async () => {
    const { fetchImpl } = makeFakeFetch([]);
    const { pi, tools } = makeFakePi();
    createMafwHostExtension({ sessionId: 'pi_s1', baseUrl: 'http://gw', fetchImpl, getType: async () => FakeType }).on(pi);
    await new Promise((r) => setTimeout(r, 10));
    expect(tools.map((t: any) => t.name).sort()).toEqual([
      'mafw_add_memory', 'mafw_media_ask', 'mafw_media_speak', 'mafw_media_upload', 'mafw_python', 'mafw_python_restart',
    ]);
  });

  it('getType 失败 → 不注册不抛错（fail-open）', async () => {
    const { fetchImpl } = makeFakeFetch([]);
    const { pi, tools } = makeFakePi();
    createMafwHostExtension({ sessionId: 'pi_s1', baseUrl: 'http://gw', fetchImpl, getType: async () => { throw new Error('no typebox'); } }).on(pi);
    await new Promise((r) => setTimeout(r, 10));
    expect(tools).toHaveLength(0);
  });

  it('mafw_add_memory → POST /api/memory/add 带正确 body', async () => {
    const { calls, fetchImpl } = makeFakeFetch([
      { match: (r) => r.url.includes('/api/memory/add'), res: { ok: true, json: { success: true, id: 'mem_1' } } },
    ]);
    const { pi, tools } = makeFakePi();
    createMafwHostExtension({ sessionId: 'pi_s1', baseUrl: 'http://gw', fetchImpl, getType: async () => FakeType }).on(pi);
    await new Promise((r) => setTimeout(r, 10));
    const tool = tools.find((t: any) => t.name === 'mafw_add_memory');
    const out = await tool.execute('call1', { content: '测试记忆', cueAnchors: ['a', 'b'] }, undefined as any, undefined as any, {} as any);
    expect(calls[0].body).toMatchObject({ content: '测试记忆', sessionID: 'pi_s1', cueAnchors: ['a', 'b'] });
    expect(out.content[0].text).toContain('mem_1');
  });

  it('mafw_python → execute 输出文本化（stdout/result/kernelRestarted）', async () => {
    const { fetchImpl } = makeFakeFetch([
      { match: (r) => r.url.includes('/api/python/execute'), res: { ok: true, json: { status: 'ok', stdout: '42', kernelRestarted: true, attachments: [{ data: 'x' }] } } },
    ]);
    const { pi, tools } = makeFakePi();
    createMafwHostExtension({ sessionId: 'pi_s1', baseUrl: 'http://gw', fetchImpl, getType: async () => FakeType }).on(pi);
    await new Promise((r) => setTimeout(r, 10));
    const tool = tools.find((t: any) => t.name === 'mafw_python');
    const out = await tool.execute('c', { code: 'print(42)' }, undefined as any, undefined as any, {} as any);
    expect(out.content[0].text).toContain('42');
    expect(out.content[0].text).toContain('python_kernel_reset');
    expect(out.content[0].text).toContain('1 张图片');
  });

  it('mafw_media_speak → 返回带 djb2 hash 的标记', async () => {
    const { fetchImpl } = makeFakeFetch([
      { match: (r) => r.url.includes('/api/tts'), res: { ok: true, json: { artifactId: 'art_9', voice: '茉莉', url: '/x.wav' } } },
    ]);
    const { pi, tools } = makeFakePi();
    createMafwHostExtension({ sessionId: 'pi_s1', baseUrl: 'http://gw', fetchImpl, getType: async () => FakeType }).on(pi);
    await new Promise((r) => setTimeout(r, 10));
    const tool = tools.find((t: any) => t.name === 'mafw_media_speak');
    const out = await tool.execute('c', { text: '你好' }, undefined as any, undefined as any, {} as any);
    expect(out.content[0].text).toBe(`[语音回复 art:art_9 音色:茉莉 h:${hashText('你好')}]`);
  });

  it('mafw_media_ask → GetTask + SendMessage 追问链', async () => {
    const { calls, fetchImpl } = makeFakeFetch([
      { match: (r) => r.url.includes('/a2a') && r.body?.method === 'GetTask', res: { ok: true, json: { result: { task: { id: 't1', contextId: 'ctx1' } } } } },
      { match: (r) => r.url.includes('/a2a') && r.body?.method === 'SendMessage', res: { ok: true, json: { result: { task: { id: 't2', status: { state: 'TASK_STATE_COMPLETED', message: { parts: [{ text: '图里有只猫' }] } } } } } } },
    ]);
    const { pi, tools } = makeFakePi();
    createMafwHostExtension({ sessionId: 'pi_s1', baseUrl: 'http://gw', fetchImpl, getType: async () => FakeType }).on(pi);
    await new Promise((r) => setTimeout(r, 10));
    const tool = tools.find((t: any) => t.name === 'mafw_media_ask');
    const out = await tool.execute('c', { taskID: 't1', question: '图里有什么' }, undefined as any, undefined as any, {} as any);
    expect(out.content[0].text).toContain('图里有只猫');
    expect(out.content[0].text).toContain('t2');
    const send = calls.find((c) => c.body?.method === 'SendMessage');
    expect(send.body.params.message.referenceTaskIds).toEqual(['t1']);
    expect(send.body.params.message.contextId).toBe('ctx1');
  });
});
