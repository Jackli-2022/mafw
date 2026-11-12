import * as http from 'http';
import { handlePods, type PodRouteDeps } from '../../src/routes/pods';

function mockRes() {
  const res: any = {
    status: 0,
    body: '',
    writeHead(s: number) { this.status = s; },
    end(b?: string) { this.body = b ?? ''; },
  };
  return res as http.ServerResponse & { status: number; body: string };
}

function mockReq(method: string, body?: any, principal?: any): http.IncomingMessage {
  const listeners: Record<string, Function[]> = {};
  const req: any = { method, on(ev: string, fn: Function) { (listeners[ev] ??= []).push(fn); } };
  if (principal) req.mafwPrincipal = principal;
  setImmediate(() => {
    if (body !== undefined) for (const fn of listeners['data'] ?? []) fn(JSON.stringify(body));
    for (const fn of listeners['end'] ?? []) fn();
  });
  return req as http.IncomingMessage;
}

/** Human-only review mutations: inject a human principal explicitly. */
const HUMAN = { kind: 'human', method: 'human-token' };

async function call(deps: PodRouteDeps, method: string, url: string, body?: any, principal: any = HUMAN) {
  const res = mockRes();
  const handled = await handlePods(mockReq(method, body, principal), res, url, deps);
  return { handled, status: res.status, json: res.body ? JSON.parse(res.body) : null };
}

describe('review item routes', () => {
  test('lists by revision and rejects agent mutations', async () => {
    const calls: string[] = [];
    const deps = {
      pods: { get: () => ({ pod: { id: 'pod_1' } }) },
      reviews: {
        list: (_podId: string, _goalId: string, opts: any) => ({ revision: opts?.revision ?? 1, items: [] }),
        createItems: (..._args: any[]) => { calls.push('create'); return []; },
        resolve: (..._args: any[]) => { calls.push('resolve'); return { id: 'review_1', status: 'resolved' }; },
        reopen: (..._args: any[]) => { calls.push('reopen'); return { id: 'review_1', status: 'pending' }; },
      },
    } as any as PodRouteDeps;

    const listed = await call(deps, 'GET', '/api/pods/pod_1/goals/g1/review-items?revision=2');
    expect(listed.status).toBe(200);
    expect(listed.json).toEqual({ revision: 2, items: [] });

    const create = await call(deps, 'POST', '/api/pods/pod_1/goals/g1/review-items', {
      items: [{ rel: 'src/a.ts', comment: 'x' }],
      actorSessionID: 'ses_agent',
    });
    expect(create.status).toBe(403);

    const resolve = await call(deps, 'POST', '/api/pods/pod_1/goals/g1/review-items/review_1/resolve', {
      actorSessionID: 'ses_agent',
    });
    expect(resolve.status).toBe(403);

    const ok = await call(deps, 'POST', '/api/pods/pod_1/goals/g1/review-items/review_1/resolve', {});
    expect(ok.status).toBe(200);
    expect(ok.json.item.status).toBe('resolved');
    expect(calls).toEqual(['resolve']);
  });

  test('accepts a review batch larger than the generic pod JSON limit', async () => {
    const deps = {
      pods: { get: () => ({ pod: { id: 'pod_1' } }) },
      reviews: {
        createItems: (_podId: string, _goalId: string, input: any) => input.items,
      },
    } as any as PodRouteDeps;
    const res = await call(deps, 'POST', '/api/pods/pod_1/goals/g1/review-items', {
      items: [{ rel: 'src/a.ts', comment: '大文件', code: 'x'.repeat(100 * 1024) }],
    });
    expect(res.status).toBe(200);
    expect(res.json.items).toHaveLength(1);
  });

  test('rejects invalid revisions before calling the service', async () => {
    const deps = {
      pods: { get: () => ({ pod: { id: 'pod_1' } }) },
      reviews: { list: () => ({ revision: 1, items: [] }) },
    } as any as PodRouteDeps;
    const res = await call(deps, 'GET', '/api/pods/pod_1/goals/g1/review-items?revision=0');
    expect(res.status).toBe(400);
  });
});
