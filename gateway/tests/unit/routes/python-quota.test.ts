/**
 * E4-6 `POST /api/python/execute` 并发帽拒绝路径（spec §4.6）。
 * 内核池满必须是 429 quota_exceeded，而不是 502 "内核崩了"。
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { attachPythonRoutes } from '../../../src/routes/python';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { QuotaExceededError } from '../../../src/resources/quotas';

function fakeReq(body: unknown): IncomingMessage {
  const listeners: Record<string, Array<(c?: unknown) => void>> = {};
  const req: any = {
    method: 'POST',
    url: '/api/python/execute',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    on(ev: string, fn: (c?: unknown) => void) {
      (listeners[ev] = listeners[ev] || []).push(fn);
      return req;
    },
  };
  process.nextTick(() => {
    for (const fn of listeners['data'] ?? []) fn(JSON.stringify(body));
    for (const fn of listeners['end'] ?? []) fn();
  });
  return req as IncomingMessage;
}

function fakeRes(): { res: ServerResponse; out: { status: number; body: any } } {
  const out = { status: 0, body: null as any };
  const res = {
    writeHead(status: number) {
      out.status = status;
    },
    end(payload?: unknown) {
      out.body = payload ? JSON.parse(String(payload)) : null;
    },
    setHeader() {},
  } as unknown as ServerResponse;
  return { res, out };
}

function handlerFor(kernels: any) {
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  attachPythonRoutes(registry, { kernels: () => kernels });
  return registry.match('POST' as never, '/api/python/execute')!.def.handler;
}

describe('POST /api/python/execute: kernel cap', () => {
  it('returns 429 quota_exceeded when the pool is full', async () => {
    const handler = handlerFor({
      get: () => {
        throw new QuotaExceededError('python_kernels', 4, 4);
      },
    });
    const { res, out } = fakeRes();
    await handler(fakeReq({ sessionID: 's1', code: '1+1' }), res);

    expect(out.status).toBe(429);
    expect(out.body).toMatchObject({
      code: 'quota_exceeded',
      resource: 'python_kernels',
      limit: 4,
      current: 4,
    });
    expect(typeof out.body.error).toBe('string');
  });

  it('keeps the generic 502 for kernel failures', async () => {
    const handler = handlerFor({
      get: () => ({
        execute: async () => {
          throw new Error('内核进程已退出');
        },
      }),
    });
    const { res, out } = fakeRes();
    await handler(fakeReq({ sessionID: 's1', code: '1+1' }), res);

    expect(out.status).toBe(502);
    expect(out.body).toEqual({ error: '内核进程已退出' });
  });
});
