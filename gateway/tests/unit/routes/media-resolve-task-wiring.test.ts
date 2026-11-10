// Phase D1 Task C4: /api/media/resolve-task/:id registry wiring — loopback gate,
// 503 without MediaAgent, taskId → artifactId (null fallback), 500 on throw.
import type { IncomingMessage, ServerResponse } from 'http';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachMediaRoutes } from '../../../src/routes/media-upload';

function fakeReq(opts: { url: string; remoteAddress?: string }): IncomingMessage {
  return {
    method: 'GET',
    url: opts.url,
    socket: { remoteAddress: opts.remoteAddress ?? '127.0.0.1' },
    headers: {},
    on() { return this; },
  } as unknown as IncomingMessage;
}

function fakeRes(): { res: ServerResponse; status: number; body: string } {
  const out = { res: null as unknown as ServerResponse, status: 200, body: '' };
  out.res = {
    writeHead: (status: number) => { out.status = status; },
    end: (payload?: unknown) => { out.body = String(payload ?? ''); },
    setHeader: () => {},
  } as unknown as ServerResponse;
  return out;
}

function setup(opts: { artifactId?: string | null; noAgent?: boolean; throws?: boolean } = {}) {
  const asked: string[] = [];
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  attachMediaRoutes(registry, {
    getMediaAgent: () => (opts.noAgent ? null : ({
      resolveTaskArtifactId: async (taskId: string) => {
        asked.push(taskId);
        if (opts.throws) throw new Error('store exploded');
        return opts.artifactId === undefined ? 'art-9' : (opts.artifactId ?? undefined);
      },
    } as any)),
    getMediaService: () => null,
  });
  return { registry, asked };
}

const handlerFor = (registry: RouteRegistry, url: string) => {
  const m = registry.match('GET', url);
  if (!m?.def.handler) return undefined;
  const handler = m.def.handler;
  return (req: IncomingMessage, res: ServerResponse) => handler(req, res, m.params);
};

describe('media resolve-task registry wiring (D1 Task C4)', () => {
  it('route is attached and resolves the decoded task id', async () => {
    const { registry, asked } = setup();
    const handler = handlerFor(registry, '/api/media/resolve-task/task%201');
    expect(handler).toBeDefined();
    const r = fakeRes();
    await handler!(fakeReq({ url: '/api/media/resolve-task/task%201' }), r.res);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ artifactId: 'art-9' });
    // Registry params arrive decoded — the handler must not decode twice.
    expect(asked).toEqual(['task 1']);
  });

  it('missing artifact resolves to null (not 404)', async () => {
    const { registry } = setup({ artifactId: null });
    const r = fakeRes();
    await handlerFor(registry, '/api/media/resolve-task/t1')!(fakeReq({ url: '/api/media/resolve-task/t1' }), r.res);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ artifactId: null });
  });

  it('403 for non-loopback callers (gate preserved)', async () => {
    const { registry, asked } = setup();
    const r = fakeRes();
    await handlerFor(registry, '/api/media/resolve-task/t1')!(fakeReq({ url: '/api/media/resolve-task/t1', remoteAddress: '10.0.0.7' }), r.res);
    expect(r.status).toBe(403);
    expect(JSON.parse(r.body)).toEqual({ error: 'forbidden' });
    expect(asked).toHaveLength(0);
  });

  it('503 without MediaAgent, 500 when the agent throws', async () => {
    let r = fakeRes();
    await handlerFor(setup({ noAgent: true }).registry, '/api/media/resolve-task/t1')!(fakeReq({ url: '/api/media/resolve-task/t1' }), r.res);
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body).error).toBe('MediaAgent not initialized');

    r = fakeRes();
    await handlerFor(setup({ throws: true }).registry, '/api/media/resolve-task/t1')!(fakeReq({ url: '/api/media/resolve-task/t1' }), r.res);
    expect(r.status).toBe(500);
    expect(JSON.parse(r.body).error).toBe('store exploded');
  });
});
