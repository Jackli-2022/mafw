import { createMafwHostExtension } from '../../../src/runtime/pi/pi-mafw-host-extension';
import { hashText, buildRecallQuery } from '../../../src/runtime/host-adapter';
import { buildMafwToolFactory } from '../../../src/runtime/mafw-tools';

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
  // 忠实模拟 typebox 1.3.7 Unsafe：Clone + ~unsafe 为 non-enumerable（不入 JSON 序列化）
  Unsafe: (s: any) => {
    const c: any = { ...s };
    Object.defineProperty(c, '~unsafe', { value: null, enumerable: false });
    return c;
  },
};

describe('pi-mafw-host tools（gateway 单源 factory 消费）', () => {
  it('注册 14 个工具——toolFactory 接 buildMafwToolFactory（端到端）', async () => {
    const { fetchImpl } = makeFakeFetch([]);
    const { pi, tools } = makeFakePi();
    createMafwHostExtension({
      sessionId: 'pi_s1', baseUrl: 'http://gw', fetchImpl, getType: async () => FakeType,
      toolFactory: buildMafwToolFactory({ baseUrl: 'http://gw', fetchImpl }),
    }).on(pi);
    await new Promise((r) => setTimeout(r, 10));
    expect(tools.map((t: any) => t.name).sort()).toEqual([
      'mafw_add_memory', 'mafw_media_ask', 'mafw_media_speak', 'mafw_media_upload', 'mafw_message_subagent',
      'mafw_python', 'mafw_python_restart', 'mafw_spawn_subagent', 'mafw_subagent_result', 'mafw_submit_result',
      'mafw_task_cancel', 'mafw_task_list', 'mafw_task_message', 'mafw_task_submit',
    ]);
  });

  it('parameters 经 T.Unsafe 包装：JSON 序列化与原 spec 逐字一致且不含 ~unsafe', async () => {
    const { fetchImpl } = makeFakeFetch([]);
    const { pi, tools } = makeFakePi();
    const factory = (sid: string) => [{
      name: 'mafw_x', label: 'L', description: `D@${sid}`,
      parameters: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
      execute: async () => ({ text: 'ok' }),
    }];
    createMafwHostExtension({ sessionId: 'pi_s1', baseUrl: 'http://gw', fetchImpl, getType: async () => FakeType, toolFactory: factory }).on(pi);
    await new Promise((r) => setTimeout(r, 10));
    expect(tools).toHaveLength(1);
    expect(JSON.stringify(tools[0].parameters)).toBe(JSON.stringify(factory('x')[0].parameters));
    expect(JSON.stringify(tools[0].parameters)).not.toContain('~unsafe');
  });

  it('execute 桥接：{text} → pi ToolResult；isError → isError: true', async () => {
    const { fetchImpl } = makeFakeFetch([]);
    const { pi, tools } = makeFakePi();
    const factory = (sid: string) => [
      { name: 't_ok', description: 'd', parameters: { type: 'object', properties: {} }, execute: async (p: any) => ({ text: `ran@${sid}:${p.x}` }) },
      { name: 't_err', description: 'd', parameters: { type: 'object', properties: {} }, execute: async () => ({ text: 'boom', isError: true }) },
    ];
    createMafwHostExtension({ sessionId: 'pi_s2', baseUrl: 'http://gw', fetchImpl, getType: async () => FakeType, toolFactory: factory }).on(pi);
    await new Promise((r) => setTimeout(r, 10));
    const okOut = await tools.find((t: any) => t.name === 't_ok').execute('c', { x: 1 }, undefined as any);
    expect(okOut.content[0].text).toBe('ran@pi_s2:1');
    expect(okOut.isError).toBeUndefined();
    const errOut = await tools.find((t: any) => t.name === 't_err').execute('c', {}, undefined as any);
    expect(errOut.content[0].text).toBe('boom');
    expect(errOut.isError).toBe(true);
  });

  it('无 toolFactory → 不注册；getType 失败 → 同样跳过（fail-open）', async () => {
    const { fetchImpl } = makeFakeFetch([]);
    const a = makeFakePi();
    createMafwHostExtension({ sessionId: 'pi_s1', baseUrl: 'http://gw', fetchImpl, getType: async () => FakeType }).on(a.pi);
    await new Promise((r) => setTimeout(r, 10));
    expect(a.tools).toHaveLength(0);
    const b = makeFakePi();
    createMafwHostExtension({
      sessionId: 'pi_s1', baseUrl: 'http://gw', fetchImpl,
      getType: async () => { throw new Error('no typebox'); },
      toolFactory: () => [{ name: 't', description: 'd', parameters: {}, execute: async () => ({ text: '' }) }],
    }).on(b.pi);
    await new Promise((r) => setTimeout(r, 10));
    expect(b.tools).toHaveLength(0);
  });
});
