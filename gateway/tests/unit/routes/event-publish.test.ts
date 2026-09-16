/**
 * POST /api/events —— 事件发布接口：插件/外部程序向全部 UI 通道
 * （SSE + WebSocket + 移动端推送）广播自定义事件。
 *
 * 业界语义（调研 2026-09-16）：SSE 事件是通知语义（JSON-RPC 通知分支），
 * 消费方对未知 type 静默忽略/打日志——发送方随时可加新类型，无注册制。
 * 双形态：opencode_event 信封（复用形状守卫）或顶层扁平广播。
 */
import * as http from 'http';
import { handleEventPublish } from '../../../src/routes/event-publish';

function createServer(deps: { broadcast: (e: any) => void }): http.Server {
  return http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url?.match(/^\/api\/events(?:\?|$)/)) {
      await handleEventPublish(deps, req, res);
      return;
    }
    res.writeHead(404); res.end();
  });
}

function post(server: http.Server, body: any): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1', port: addr.port, path: '/api/events', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let chunks = '';
      res.on('data', (c) => chunks += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode!, body: JSON.parse(chunks) }); }
        catch { resolve({ status: res.statusCode!, body: chunks }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

describe('POST /api/events (publish)', () => {
  let server: http.Server;
  let broadcasted: any[];
  afterEach((done) => { server?.close(() => done()); });

  function start() {
    broadcasted = [];
    server = createServer({ broadcast: (e) => broadcasted.push(e) });
    return new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  }

  it('扁平事件广播（顶层 type）', async () => {
    await start();
    const res = await post(server, { type: 'plugin:acme:quota', level: 'warn' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(broadcasted).toHaveLength(1);
    expect(broadcasted[0]).toMatchObject({ type: 'plugin:acme:quota', level: 'warn' });
  });

  it('opencode_event 信封旁路（data 内层透传）', async () => {
    await start();
    const res = await post(server, { type: 'opencode_event', data: { type: 'session.idle', sessionID: 's1' } });
    expect(res.status).toBe(200);
    expect(broadcasted).toHaveLength(1);
    expect(broadcasted[0].type).toBe('opencode_event');
    expect(broadcasted[0].data).toMatchObject({ type: 'session.idle', sessionID: 's1' });
  });

  it('信封 data.type 缺失 → 400（形状守卫）', async () => {
    await start();
    const res = await post(server, { type: 'opencode_event', data: { sessionID: 's1' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/data\.type/i);
    expect(broadcasted).toHaveLength(0);
  });

  it('缺 type → 400 字段级消息', async () => {
    await start();
    const res = await post(server, { level: 'warn' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/type/);
    expect(broadcasted).toHaveLength(0);
  });

  it('非对象 body → 400', async () => {
    await start();
    const res = await post(server, '"just a string"');
    expect(res.status).toBe(400);
    expect(broadcasted).toHaveLength(0);
  });

  it('坏 JSON → 400', async () => {
    await start();
    const res = await post(server, '{broken');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/json/i);
  });
});
