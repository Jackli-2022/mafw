// Phase D1 Task H2: GET /api/events (SSE) registry wiring. The branch is a single
// `req.url && req.url.startsWith('/api/events') && GET` blind spot with no state
// beyond the handler invocation (conn.write + replay cursor are owned by
// attachGlobalSse; req close removes the sseClients entry). Registry dispatch
// reaches it before the legacy chain, so both modes must stay byte-identical:
// Mode B registers the response with chatSessions, Mode A attaches the global
// stream (greeting frame + per-connection write in the shared map).
import type { IncomingMessage, ServerResponse } from 'http';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachEventsSseRoutes } from '../../../src/routes/events-sse';

function fakeReq(opts: { url: string; headers?: Record<string, string> }): { req: IncomingMessage; emit: (ev: string) => void } {
  const listeners: Record<string, Array<() => void>> = {};
  const req: any = {
    method: 'GET',
    url: opts.url,
    socket: { remoteAddress: '127.0.0.1' },
    headers: opts.headers ?? { host: '127.0.0.1:3000' },
    on(ev: string, fn: () => void) {
      (listeners[ev] = listeners[ev] || []).push(fn);
      return req;
    },
  };
  return { req: req as IncomingMessage, emit: (ev) => { for (const fn of listeners[ev] ?? []) fn(); } };
}

interface FakeRes {
  res: ServerResponse;
  status: number;
  headers: Record<string, unknown>;
  frames: string[];
  ended: boolean;
}

function fakeRes(): FakeRes {
  const out: FakeRes = { res: null as unknown as ServerResponse, status: 200, headers: {}, frames: [], ended: false };
  out.res = {
    writeHead: (status: number, headers?: Record<string, unknown>) => {
      out.status = status;
      if (headers) Object.assign(out.headers, headers);
    },
    write: (chunk: unknown) => { out.frames.push(String(chunk)); return true; },
    end: () => { out.ended = true; },
    setHeader: () => {},
  } as unknown as ServerResponse;
  return out;
}

function setup(over: { register?: (sessionID: string, res: ServerResponse) => void; eventStore?: () => any } = {}) {
  const registered: Array<[string, ServerResponse]> = [];
  const sseClients = new Map<ServerResponse, (frame: string, seq: number | null) => void>();
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  attachEventsSseRoutes(registry, {
    chatSessions: () => ({
      register: (sessionID: string, res: ServerResponse) => {
        registered.push([sessionID, res]);
        if (over.register) over.register(sessionID, res);
      },
    }) as any,
    eventStore: over.eventStore ?? (() => null),
    sseClients: () => sseClients,
  });
  return { registry, registered, sseClients };
}

const handlerFor = (registry: RouteRegistry, url: string) => {
  const m = registry.match('GET', url);
  if (!m?.def.handler) return undefined;
  const handler = m.def.handler;
  return (req: IncomingMessage, res: ServerResponse) => handler(req, res, m.params);
};

/**
 * SSE 事件块的 data 行。E1-13 起 greeting 块带 `retry: 3000`（重连提示），
 * 所以不能再假设帧以 `data: ` 开头——按 SSE 语义取 data 行。
 */
function dataOf(frame: string): any {
  const m = /(?:^|\n)data: (.*)$/s.exec(frame);
  if (!m) throw new Error(`frame has no data line: ${JSON.stringify(frame)}`);
  return JSON.parse(m[1]);
}

describe('events SSE registry wiring (D1 Task H2)', () => {
  it('binds event.subscribe (GET /api/events) while POST stays with wave1', () => {
    const { registry } = setup();
    expect(registry.match('GET', '/api/events')?.def.operationId).toBe('event.subscribe');
    expect(handlerFor(registry, '/api/events')).toBeDefined();
    expect(registry.match('POST', '/api/events')?.def.operationId).toBe('event.publish');
  });

  it('Mode B registers the response with chatSessions and does not touch sseClients', async () => {
    const { registry, registered, sseClients } = setup();
    const r = fakeRes();
    const { req } = fakeReq({ url: '/api/events?sessionID=ses_42' });
    await handlerFor(registry, '/api/events')!(req, r.res);
    expect(registered).toHaveLength(1);
    expect(registered[0][0]).toBe('ses_42');
    expect(registered[0][1]).toBe(r.res);
    expect(sseClients.size).toBe(0);
    expect(r.frames).toHaveLength(0);
  });

  it('Mode A attaches the global stream: SSE headers + greeting + sseClients write', async () => {
    const { registry, registered, sseClients } = setup();
    const r = fakeRes();
    const { req } = fakeReq({ url: '/api/events' });
    await handlerFor(registry, '/api/events')!(req, r.res);
    expect(registered).toHaveLength(0);
    expect(r.status).toBe(200);
    expect(r.headers['Content-Type']).toBe('text/event-stream');
    expect(r.frames).toHaveLength(1);
    const greeting = dataOf(r.frames[0]);
    expect(greeting).toMatchObject({ type: 'connected', vocab: 'v2', headSeq: 0 });
    expect(typeof sseClients.get(r.res)).toBe('function');
  });

  it('broadcast writes reach the registered connection; req close unregisters it', async () => {
    const { registry, sseClients } = setup();
    const r = fakeRes();
    const { req, emit } = fakeReq({ url: '/api/events?since=0' });
    await handlerFor(registry, '/api/events')!(req, r.res);
    const write = sseClients.get(r.res)!;
    write('data: {"type":"tick"}\n\n', 1);
    expect(r.frames.at(-1)).toBe('data: {"type":"tick"}\n\n');

    emit('close');
    expect(sseClients.has(r.res)).toBe(false);
  });

  it('a replay-capable store is passed through (greeting carries firstReplayedSeq/truncated)', async () => {
    const store = {
      headSeq: () => 9,
      replaySince: () => ({ rows: [], firstReplayedSeq: 5 }),
    };
    const { registry } = setup({ eventStore: () => store });
    const r = fakeRes();
    const { req } = fakeReq({ url: '/api/events?since=2' });
    await handlerFor(registry, '/api/events')!(req, r.res);
    const greeting = dataOf(r.frames[0]);
    expect(greeting.firstReplayedSeq).toBe(5);
    expect(greeting.truncated).toBe(true); // 5 > since + 1 → hole at the start
  });
});
