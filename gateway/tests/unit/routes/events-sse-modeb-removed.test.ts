/**
 * E3-2：Mode B（per-session `?sessionID=` SSE 通道）已删除。
 *
 * `ChatSessionManager` 自述零源码消费方（desktop/TUI 均走 Mode A 全局流），
 * 因此 `GET /api/events?sessionID=x` 必须**忽略该参数**，按 Mode A 订阅：
 * SSE headers + greeting + `sseClients` 注册 + req close 注销。
 *
 * 旧实现会把响应交给 chatSessions（Mode B），不碰全局流——本测试在该树上必红。
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachEventsSseRoutes } from '../../../src/routes/events-sse';

function fakeReq(opts: { url: string; headers?: Record<string, string> }): {
  req: IncomingMessage;
  emit: (ev: string) => void;
} {
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
  return {
    req: req as IncomingMessage,
    emit: (ev) => {
      for (const fn of listeners[ev] ?? []) fn();
    },
  };
}

interface FakeRes {
  res: ServerResponse;
  status: number;
  headers: Record<string, unknown>;
  frames: string[];
}

function fakeRes(): FakeRes {
  const out: FakeRes = { res: null as unknown as ServerResponse, status: 200, headers: {}, frames: [] };
  out.res = {
    writeHead: (status: number, headers?: Record<string, unknown>) => {
      out.status = status;
      if (headers) Object.assign(out.headers, headers);
    },
    write: (chunk: unknown) => {
      out.frames.push(String(chunk));
      return true;
    },
    end: () => {},
    setHeader: () => {},
  } as unknown as ServerResponse;
  return out;
}

function setup() {
  const sseClients = new Map<ServerResponse, (frame: string, seq: number | null) => void>();
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  attachEventsSseRoutes(registry, {
    eventStore: () => null,
    sseClients: () => sseClients,
  });
  const matched = registry.match('GET', '/api/events');
  if (!matched?.def.handler) throw new Error('event.subscribe handler not attached');
  const handler = matched.def.handler;
  return {
    sseClients,
    invoke: (req: IncomingMessage, res: ServerResponse) => handler(req, res, matched.params),
  };
}

function dataOf(frame: string): any {
  const m = /(?:^|\n)data: (.*)$/s.exec(frame);
  if (!m) throw new Error(`frame has no data line: ${JSON.stringify(frame)}`);
  return JSON.parse(m[1]);
}

describe('E3-2: Mode B removed — ?sessionID is ignored', () => {
  it('GET /api/events?sessionID=x subscribes as Mode A (SSE headers + global client)', async () => {
    const { sseClients, invoke } = setup();
    const r = fakeRes();
    const { req } = fakeReq({ url: '/api/events?sessionID=ses_42' });

    await invoke(req, r.res);

    expect(r.status).toBe(200);
    expect(r.headers['Content-Type']).toBe('text/event-stream');
    expect(r.frames).toHaveLength(1);
    expect(dataOf(r.frames[0])).toMatchObject({ type: 'connected' });
    expect(typeof sseClients.get(r.res)).toBe('function');
    expect(sseClients.size).toBe(1);
  });

  it('sessionID request keeps Mode A replay semantics (?since honored)', async () => {
    const sseClients = new Map<ServerResponse, (frame: string, seq: number | null) => void>();
    const registry = new RouteRegistry().register(...buildRouteCatalog());
    attachEventsSseRoutes(registry, {
      eventStore: () => ({ headSeq: () => 9, replaySince: () => ({ rows: [], firstReplayedSeq: 5 }) }),
      sseClients: () => sseClients,
    });
    const matched = registry.match('GET', '/api/events')!;
    const r = fakeRes();
    const { req } = fakeReq({ url: '/api/events?sessionID=ses_42&since=2' });

    await matched.def.handler!(req, r.res, matched.params);

    const greeting = dataOf(r.frames[0]);
    expect(greeting.firstReplayedSeq).toBe(5);
    expect(greeting.truncated).toBe(true);
    expect(sseClients.has(r.res)).toBe(true);
  });

  it('req close unregisters the global client', async () => {
    const { sseClients, invoke } = setup();
    const r = fakeRes();
    const { req, emit } = fakeReq({ url: '/api/events?sessionID=ses_42' });

    await invoke(req, r.res);
    expect(sseClients.has(r.res)).toBe(true);
    emit('close');
    expect(sseClients.has(r.res)).toBe(false);
  });
});
