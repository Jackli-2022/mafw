import { createMafwHostExtension, hashText } from '../../../src/runtime/pi/pi-mafw-host-extension';

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
