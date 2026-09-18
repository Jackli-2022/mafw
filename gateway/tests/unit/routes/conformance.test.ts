import * as http from 'http';
import { handleConformance, type ConformanceDeps } from '../../../src/routes/conformance';

function fakeRes() {
  let payload = '';
  const res: any = { writeHead: () => res, end: (b: string) => { payload = b; return res; } };
  return { res, body: () => JSON.parse(payload) };
}

function makeDeps(overrides: Partial<ConformanceDeps> = {}): ConformanceDeps {
  const sessions = new Map<string, boolean>();
  return {
    runtimeName: () => 'fake-runtime',
    caps: () => ({ sessionApi: true, eventStream: true }),
    createSession: async () => { const id = 't1'; sessions.set(id, true); return { id }; },
    promptAsync: async () => {},
    deleteSession: async (id: string) => { sessions.delete(id); },
    listSessions: async () => [...sessions.keys()].map((id) => ({ id })),
    registerEventTap: (_sid: string, cb: (e: any) => void) => {
      // 立即回放一条成功序列，模拟 runtime 事件
      setTimeout(() => { cb({ type: 'message.part.updated', sessionID: 't1', at: 1 }); cb({ type: 'message.complete', sessionID: 't1', at: 2 }); }, 5);
      return () => {};
    },
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
    expect(json.summary).toEqual({ pass: 2, fail: 0 });
    expect(json.results.every((r: any) => r.pass)).toBe(true);
    expect(json.runtime).toBe('fake-runtime');
  });

  it('reports failure when tap sees nothing (timeout fast path)', async () => {
    const deps = makeDeps({ registerEventTap: () => () => {} });
    const json = await post({ timeoutMs: 200 }, deps);
    expect(json.summary.fail).toBe(1);
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
});
