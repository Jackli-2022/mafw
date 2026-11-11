/**
 * E1-13 SSE 卫生（spec §E1-13 / B17）。
 *
 * 缺陷：Mode A 全局 SSE 无 `retry:`、无 `: ping` 保活、无 `X-Accel-Buffering: no`
 * （反代缓冲导致事件延迟）；全局 CORS 默认方法与头不含 PUT/PATCH/DELETE /
 * Authorization / X-API-Token（远程/移动端预检被拒）。
 *
 * 钉住：
 *  (a) attach 响应头含 X-Accel-Buffering: no；
 *  (b) 首帧带 retry: 3000（与 greeting 同一 SSE 事件块，不新增帧）；
 *  (c) 15s `: ping` 注释帧，unref，close 后停止；
 *  (d) 默认 CORS 下 OPTIONS PUT/PATCH/DELETE → 204 且放行 Authorization +
 *      X-API-Token；显式配置优先。
 */
import { PassThrough } from 'stream';
import type { IncomingMessage, ServerResponse } from 'http';
import { attachGlobalSse } from '../../../src/events/sse-attach';
import { DEFAULT_SERVER_CORS } from '../../../src/config';
import { createRequestListener, type TransportDeps } from '../../../src/http/transport';

const PING_MS = 15_000;

function fakeSseRes() {
  const res = new PassThrough() as any;
  res.status = undefined;
  res.headers = {};
  res.chunks = [];
  res.writeHead = (status: number, headers?: Record<string, string>) => {
    res.status = status;
    res.headers = headers ?? {};
    return res;
  };
  res.on('data', (c: Buffer) => res.chunks.push(c.toString()));
  return res;
}

function attach(res: any, since: number | null = null) {
  return attachGlobalSse({
    res,
    store: null,
    replayLimit: 100,
    writeFrame: (r, frame) => { if (frame) r.write(frame); },
    since,
  });
}

function frames(res: any): string[] {
  return res.chunks.join('').split('\n\n').filter((s: string) => s.trim());
}

describe('attachGlobalSse 卫生头（E1-13 a/b）', () => {
  it('响应头含 X-Accel-Buffering: no，且保留既有 SSE 头', () => {
    const res = fakeSseRes();
    attach(res);
    expect(res.status).toBe(200);
    expect(res.headers['X-Accel-Buffering']).toBe('no');
    expect(res.headers['Content-Type']).toBe('text/event-stream');
    expect(res.headers['Cache-Control']).toBe('no-cache');
    expect(res.headers['Connection']).toBe('keep-alive');
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
  });

  it('首帧带 retry: 3000，greeting 仍是第一个数据帧', () => {
    const res = fakeSseRes();
    attach(res);
    const raw = res.chunks.join('');
    expect(raw.startsWith('retry: 3000')).toBe(true);

    const [first] = frames(res);
    expect(first).toContain('retry: 3000');
    expect(first).toMatch(/(?:^|\n)data: /);
    const data = JSON.parse(/(?:^|\n)data: (.*)$/s.exec(first)![1]);
    expect(data.type).toBe('connected');
    expect(data.headSeq).toBe(0);
  });
});

describe('attachGlobalSse 保活（E1-13 c）', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('每 15s 写一个 : ping 注释帧；unref；close 后停止', () => {
    const res = fakeSseRes();
    const conn = attach(res);

    expect(conn.timer.hasRef()).toBe(false);
    expect(res.chunks.join('')).not.toContain(': ping');

    jest.advanceTimersByTime(PING_MS);
    expect(res.chunks.join('').match(/: ping\n\n/g)).toHaveLength(1);

    jest.advanceTimersByTime(PING_MS);
    expect(res.chunks.join('').match(/: ping\n\n/g)).toHaveLength(2);

    const beforeClose = res.chunks.length;
    res.emit('close');
    jest.advanceTimersByTime(PING_MS * 4);
    expect(res.chunks.length).toBe(beforeClose);
  });

  it('dispose() 同样清理定时器（幂等）', () => {
    const res = fakeSseRes();
    const conn = attach(res);
    jest.advanceTimersByTime(PING_MS);
    const before = res.chunks.length;

    conn.dispose();
    conn.dispose();
    jest.advanceTimersByTime(PING_MS * 2);
    expect(res.chunks.length).toBe(before);
  });
});

// ── (d) CORS 默认值 + OPTIONS 预检 ──────────────────────────────────────────

function fakeRes(): { res: ServerResponse; rec: { status?: number; headers: Record<string, string>; ended: boolean } } {
  const rec: { status?: number; headers: Record<string, string>; ended: boolean } = { headers: {}, ended: false };
  const res = {
    headersSent: false,
    setHeader(name: string, value: string) { rec.headers[name.toLowerCase()] = String(value); return this; },
    writeHead(status: number, headers?: Record<string, string>) {
      rec.status = status;
      this.headersSent = true;
      if (headers) for (const [k, v] of Object.entries(headers)) rec.headers[k.toLowerCase()] = String(v);
      return this;
    },
    end() { rec.ended = true; this.headersSent = true; return this; },
    write() { return true; },
  } as unknown as ServerResponse;
  return { res, rec };
}

function fakeReq(method: string, url: string): IncomingMessage {
  return {
    method,
    url,
    headers: {},
    socket: { remoteAddress: '203.0.113.9' }, // 非 loopback：预检必须先于鉴权
    on() { return this; },
    pipe() { return this; },
  } as unknown as IncomingMessage;
}

function listenerWithCors(cors: { origin: string; methods: string; headers: string }) {
  const deps: TransportDeps = {
    cors: () => cors,
    apiToken: () => 'sekret',
    dispatchAuthorized: async () => false,
    pluginWebWildcard: async () => false,
    fileHistory: async () => false,
    mediaAgent: () => undefined,
    mcpEndpoint: () => undefined,
    mcpStreamable: () => undefined,
    spaRoot: () => '/nonexistent-dashboard-root',
    dashboardDispatch: async () => ({ status: 200, body: {} }),
    register: {
      parseIntent: () => null,
      isUserDataDir: () => false,
      isSelectableProject: () => true,
      registeredProject: () => undefined,
      registerProject: () => undefined,
      setCurrentProject: () => undefined,
      persistRegistry: async () => undefined,
      broadcastProjectRegistered: () => undefined,
      hasRuntime: () => false,
      ensureManagerSession: async () => 'sid',
    },
    control: {
      patchState: async () => undefined,
      destroyAllSessions: async () => undefined,
      getActiveGoal: () => undefined,
      registeredProjects: () => new Map<string, { mafwDir: string }>().entries(),
      getGatewayDb: () => ({} as never),
      archiveGoal: async () => undefined,
    },
    health: {
      serveRunning: () => false,
      registeredProjectDirs: () => [],
      activeGoalIds: () => [],
      mediaConfigured: () => false,
      releaseFields: () => ({}),
    },
    proxyTarget: () => 'http://127.0.0.1:9',
  };
  return createRequestListener(deps);
}

describe('CORS 默认值与 OPTIONS 预检（E1-13 d）', () => {
  it('默认 CORS 放行 PUT/PATCH/DELETE + Authorization/X-API-Token', () => {
    expect(DEFAULT_SERVER_CORS.methods).toContain('PUT');
    expect(DEFAULT_SERVER_CORS.methods).toContain('PATCH');
    expect(DEFAULT_SERVER_CORS.methods).toContain('DELETE');
    expect(DEFAULT_SERVER_CORS.headers).toContain('Authorization');
    expect(DEFAULT_SERVER_CORS.headers).toContain('X-API-Token');
  });

  it.each(['PUT', 'PATCH', 'DELETE'])('%s 预检 → 204 + 允许方法与头', async (method) => {
    const listener = listenerWithCors(DEFAULT_SERVER_CORS);
    const { res, rec } = fakeRes();
    await listener(fakeReq('OPTIONS', '/api/sessions'), res);
    expect(rec.status).toBe(204);
    expect(rec.ended).toBe(true);
    expect(rec.headers['access-control-allow-origin']).toBe('*');
    expect(rec.headers['access-control-allow-methods']).toContain(method);
    expect(rec.headers['access-control-allow-headers']).toContain('Authorization');
    expect(rec.headers['access-control-allow-headers']).toContain('X-API-Token');
  });

  it('显式配置优先（不被默认值覆盖）', async () => {
    const explicit = { origin: 'https://example.test', methods: 'GET,POST', headers: 'Content-Type' };
    const listener = listenerWithCors(explicit);
    const { res, rec } = fakeRes();
    await listener(fakeReq('OPTIONS', '/api/sessions'), res);
    expect(rec.status).toBe(204);
    expect(rec.headers['access-control-allow-origin']).toBe('https://example.test');
    expect(rec.headers['access-control-allow-methods']).toBe('GET,POST');
    expect(rec.headers['access-control-allow-headers']).toBe('Content-Type');
  });
});
