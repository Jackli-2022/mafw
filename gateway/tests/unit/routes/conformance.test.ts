import * as http from 'http';
import { handleConformance, type ConformanceDeps } from '../../../src/routes/conformance';

function fakeRes() {
  let payload = '';
  const res: any = { writeHead: () => res, end: (b: string) => { payload = b; return res; } };
  return { res, body: () => JSON.parse(payload) };
}

function makeDeps(overrides: Partial<ConformanceDeps> = {}): ConformanceDeps {
  const sessions = new Map<string, boolean>();
  let tapCb: ((e: any) => void) | undefined;
  return {
    runtimeName: () => 'fake-runtime',
    caps: () => ({ sessionApi: true, eventStream: true }),
    createSession: async () => { const id = 't1'; sessions.set(id, true); return { id }; },
    promptAsync: async () => {},
    deleteSession: async (id: string) => { sessions.delete(id); },
    listSessions: async () => [...sessions.keys()].map((id) => ({ id })),
    registerEventTap: (_sid: string, cb: (e: any) => void) => {
      tapCb = cb;
      // 立即回放一条成功序列，模拟 runtime 事件（chat-roundtrip 等场景依赖）
      setTimeout(() => { cb({ type: 'part.updated', sessionID: 't1', at: 1 }); cb({ type: 'turn.completed', sessionID: 't1', at: 2 }); }, 5);
      return () => {};
    },
    // 模拟 handleOpencodeEvent 的 tap 快照形状（normalize + enrichToolClass 已发生）
    injectEvent: (evt: any) => {
      const part = evt?.properties?.part
        ? { ...evt.properties.part, toolClass: evt.properties.part.toolClass ?? 'other' }
        : undefined;
      tapCb?.({ type: evt.type, sessionID: evt.properties.sessionID, at: Date.now(), ...(part ? { part } : {}) });
    },
    getObservations: async () => [
      { source: 'user_input', content: 'prompt' },
      { source: 'tool_result', content: '[shell]\nfile.txt' },
      { source: 'assistant_reply', content: 'DONE ## 记忆 [MAFW MANAGER IDENTITY]' },
    ],
    getRecallCalledAt: () => 123,
    bindIdentity: () => {},
    evaluatePolicy: (_sid: string, c: { toolName: string }) => ({
      action: c.toolName === 'bash' ? 'human' : 'auto-deny',
    }),
    // B2：历史形状断言的数据面（合法 {info,parts[]}）
    getMessages: async () => [{ id: 'm1', role: 'user', content: [] }],
    // B3：无 unmatched 差分（健康基线）
    translationDrops: () => ({}),
    ...overrides,
  } as ConformanceDeps;
}

async function post(body: unknown, deps: ConformanceDeps): Promise<any> {
  const req: any = {
    on: (ev: string, cb: (d?: string) => void) => {
      if (ev === 'data') setTimeout(() => cb(JSON.stringify(body)), 0);
      if (ev === 'end') setTimeout(() => cb(), 5);
      return req;
    },
  };
  const { res, body: json } = fakeRes();
  await handleConformance(req, res, deps);
  return json();
}

describe('POST /api/runtime/conformance', () => {
  it('runs all scenarios and reports pass summary', async () => {
    const json = await post({}, makeDeps());
    expect(json.summary).toEqual({ pass: 6, fail: 0 });
    expect(json.results.every((r: any) => r.pass)).toBe(true);
    expect(json.runtime).toBe('fake-runtime');
  });

  it('tool-visibility 单场景：注入探针两帧 → pass', async () => {
    const json = await post({ scenarios: ['tool-visibility'] }, makeDeps());
    expect(json.summary).toEqual({ pass: 1, fail: 0 });
    const r = json.results[0];
    expect(r.id).toBe('tool-visibility');
    expect(r.pass).toBe(true);
  });

  it('reports failure when tap sees nothing (timeout fast path)', async () => {
    const deps = makeDeps({ registerEventTap: () => () => {} });
    const json = await post({ timeoutMs: 200 }, deps);
    // chat-roundtrip（超时无内容事件）+ tool-visibility（零帧）双双失败
    expect(json.summary.fail).toBe(2);
  });

  it('marks scenarios as failed (not crash) when sessionApi missing', async () => {
    const deps = makeDeps({ caps: () => ({}) });
    const json = await post({}, deps);
    expect(json.summary.pass).toBe(0);
    expect(json.results.every((r: any) => r.pass === false)).toBe(true);
  });

  it('runs a single scenario when filtered', async () => {
    const json = await post({ scenarios: ['session-lifecycle'] }, makeDeps());
    expect(json.results.length).toBe(1);
    expect(json.results[0].id).toBe('session-lifecycle');
  });

  it('cognition-observe fails when T1 rows missing the tool_result class', async () => {
    const deps = makeDeps({
      getObservations: async () => [
        { source: 'user_input', content: 'prompt' },
        { source: 'assistant_reply', content: 'DONE' },
      ],
    });
    const json = await post({ scenarios: ['cognition-observe'] }, deps);
    expect(json.results[0].pass).toBe(false);
    expect(json.results[0].failures.join()).toContain('tool_result');
  });

  it('cognition-inject fails when recall never called', async () => {
    const deps = makeDeps({ getRecallCalledAt: () => null });
    const json = await post({ scenarios: ['cognition-inject'] }, deps);
    expect(json.results[0].pass).toBe(false);
    expect(json.results[0].failures.join()).toContain('recall');
  });

  it('cognition scenario marks crash (not 500) when getObservations throws', async () => {
    const deps = makeDeps({ getObservations: async () => { throw new Error('db down'); } });
    const json = await post({ scenarios: ['cognition-inject'] }, deps);
    expect(json.results[0].pass).toBe(false);
    expect(json.results[0].failures.join()).toContain('crashed');
  });
});
