import type { IncomingMessage, ServerResponse } from 'http';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachSkillRoutes } from '../../../src/routes/skills';

function fakeReq(body?: string): IncomingMessage {
  const listeners: Record<string, Array<(c?: unknown) => void>> = {};
  const req = {
    on(ev: string, fn: (c?: unknown) => void) {
      (listeners[ev] = listeners[ev] || []).push(fn);
      return req;
    },
  };
  process.nextTick(() => {
    for (const fn of listeners['data'] ?? []) fn(body ?? '');
    for (const fn of listeners['end'] ?? []) fn();
  });
  return req as unknown as IncomingMessage;
}

function fakeRes(): { res: ServerResponse; status: number; body: string } {
  const out = { status: 0, body: '' } as { status: number; body: string };
  const res = {
    writeHead(code: number) { out.status = code; return res; },
    end(chunk?: string) { out.body = chunk ?? ''; },
  };
  return { res: res as unknown as ServerResponse, get status() { return out.status; }, get body() { return out.body; } } as any;
}

describe('skills routes', () => {
  test('POST /api/skills/:name/deopt moves the skill and reports 200', async () => {
    const registry = new RouteRegistry().register(...buildRouteCatalog());
    const calls: any[] = [];
    attachSkillRoutes(registry, {
      deopt: (name, reason) => {
        calls.push({ name, reason });
        return { deopted: true, archivedTo: '/skills/.disabled/ms-a-1' };
      },
    });
    const r = fakeRes();
    const match = registry.match('POST', '/api/skills/ms-a/deopt')!;
    await match.def.handler!(fakeReq(JSON.stringify({ reason: 'source-superseded' })), r.res, match.params);
    expect(calls).toEqual([{ name: 'ms-a', reason: 'source-superseded' }]);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ deopted: true, archivedTo: '/skills/.disabled/ms-a-1' });
  });

  test('unknown skill → 404 with error', async () => {
    const registry = new RouteRegistry().register(...buildRouteCatalog());
    attachSkillRoutes(registry, {
      deopt: () => ({ deopted: false, error: 'ENOENT' }),
    });
    const r = fakeRes();
    const match = registry.match('POST', '/api/skills/ms-gone/deopt')!;
    await match.def.handler!(fakeReq('{}'), r.res, match.params);
    expect(r.status).toBe(404);
    expect(JSON.parse(r.body).error).toContain('ENOENT');
  });
});
