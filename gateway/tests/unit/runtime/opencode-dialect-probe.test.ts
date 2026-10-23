/**
 * probeOpencodeDialect —— 方言探测（SSE peek）契约测试。
 *
 * 设计 §3.2（用户裁决：v1/v2 双兼容自适应）：双发之下探测只判 v2 面可见性
 * （sync 信封或 session.next.* 出现 ⇒ 2.x serve）；无信号（idle serve）/超时/
 * 异常 ⇒ @v1 fail-safe（legacy 族在任何 serve 上都发，方向安全）。
 */
import { probeOpencodeDialect } from '../../../src/runtime/opencode-dialect-probe';

function sseBody(chunks: string[], readDelayMs = 0) {
  let i = 0;
  return {
    getReader() {
      return {
        async read(): Promise<{ done: boolean; value?: Buffer }> {
          if (i < chunks.length) {
            const value = Buffer.from(chunks[i++]);
            if (readDelayMs) await new Promise((r) => setTimeout(r, readDelayMs));
            return { done: false, value };
          }
          return { done: true, value: undefined };
        },
      };
    },
  };
}

const ok = (chunks: string[], readDelayMs = 0) =>
  (async () => ({ ok: true, status: 200, body: sseBody(chunks, readDelayMs) })) as unknown as typeof fetch;

describe('probeOpencodeDialect 2.1.0 连接面（/api/event + Basic auth）', () => {
  it('peek 打 /api/event 且带 Basic auth（根路径无认证全落 SPA）', async () => {
    let seenUrl = '';
    let seenAuth = '';
    const fetchImpl = (async (url: any, init: any) => {
      seenUrl = String(url);
      seenAuth = init?.headers?.Authorization ?? '';
      return { ok: true, status: 200, body: sseBody(['data: {"id":"e1","type":"server.connected","data":{}}\n\n']) };
    }) as unknown as typeof fetch;
    await probeOpencodeDialect('http://127.0.0.1:4096', fetchImpl, 1000);
    expect(seenUrl).toBe('http://127.0.0.1:4096/api/event');
    expect(seenAuth).toMatch(/^Basic /);
  });

  it('顶层 type + server.connected（durable 信封）→ v21', async () => {
    const fetchImpl = ok(['data: {"id":"e1","type":"server.connected","data":{}}\n\n']);
    expect(await probeOpencodeDialect('http://x', fetchImpl, 1000)).toBe('v21');
  });

  it('2.1 API 可用（/api/session 返回 JSON）→ 直接 v21，不依赖 SSE peek', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    expect(await probeOpencodeDialect('http://x', fetchImpl, 1000)).toBe('v21');
    expect(calls).toBe(1);
  });
});

describe('probeOpencodeDialect（SSE peek，fail-safe 恒 v1）', () => {
  it('sync 信封可见 → v2', async () => {
    const fetchImpl = ok(['data: {"directory":"/p","payload":{"type":"sync","syncEvent":{"type":"session.1"}}}\n\n']);
    expect(await probeOpencodeDialect('http://127.0.0.1:4096', fetchImpl, 1000)).toBe('v2');
  });

  it('session.next.* 可见 → v2', async () => {
    const fetchImpl = ok(['data: {"directory":"/p","payload":{"type":"session.next.tool.called","properties":{}}}\n\n']);
    expect(await probeOpencodeDialect('http://127.0.0.1:4096', fetchImpl, 1000)).toBe('v2');
  });

  it('流关闭无 v2 信号（v1-only serve）→ v1', async () => {
    const fetchImpl = ok(['data: {"directory":"/p","payload":{"type":"session.created","properties":{}}}\n\n']);
    expect(await probeOpencodeDialect('http://127.0.0.1:4096', fetchImpl, 1000)).toBe('v1');
  });

  it('idle serve（超时无信号）→ v1 且在 timeoutMs 内返回，不挂起（Review Focus 4）', async () => {
    const t0 = Date.now();
    const fetchImpl = ok([''], 10_000); // read 永不完成
    expect(await probeOpencodeDialect('http://127.0.0.1:4096', fetchImpl, 300)).toBe('v1');
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('fetch 抛错（serve 未起）→ v1 fail-safe', async () => {
    const fetchImpl = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    expect(await probeOpencodeDialect('http://127.0.0.1:4096', fetchImpl, 500)).toBe('v1');
  });

  it('非 2xx 响应 → v1', async () => {
    const fetchImpl = (async () => ({ ok: false, status: 404 })) as unknown as typeof fetch;
    expect(await probeOpencodeDialect('http://127.0.0.1:4096', fetchImpl, 500)).toBe('v1');
  });
});
