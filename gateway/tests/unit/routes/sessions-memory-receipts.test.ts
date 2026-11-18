import type { IncomingMessage, ServerResponse } from 'http';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachSessionsMemoryReceiptsRoutes } from '../../../src/routes/sessions-memory-receipts';

function fakeReq(url: string): IncomingMessage {
  return {
    method: 'GET',
    url,
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage;
}

function fakeRes() {
  const out = { res: null as unknown as ServerResponse, status: 0, body: '' };
  out.res = {
    writeHead: (status: number) => { out.status = status; },
    end: (payload?: unknown) => { out.body = String(payload ?? ''); },
    setHeader: () => {},
  } as unknown as ServerResponse;
  return out;
}

function setup(db: any) {
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  attachSessionsMemoryReceiptsRoutes(registry, { getGatewayDb: () => db });
  return async (url: string) => {
    const m = registry.match('GET' as never, url)!;
    const r = fakeRes();
    await (m.def.handler as any)(fakeReq(url), r.res, m.params);
    return r;
  };
}

describe('GET /api/sessions/:id/memory-receipts', () => {
  test('returns receipts from the store', async () => {
    const items = [{ anchorKey: 'turn_a', receipt: { version: 1 } }];
    const run = setup({
      listMemoryReceipts: (id: string, opts: any) => {
        expect(id).toBe('s1');
        expect(opts.limit).toBe(2);
        return items;
      },
    });
    const r = await run('/api/sessions/s1/memory-receipts?limit=2');
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ items });
  });

  test('fails open with an empty list when the store throws', async () => {
    const run = setup({ listMemoryReceipts: () => { throw new Error('db busy'); } });
    const r = await run('/api/sessions/s1/memory-receipts');
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ items: [] });
  });
});
