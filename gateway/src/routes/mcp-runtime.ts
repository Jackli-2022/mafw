// gateway/src/routes/mcp-runtime.ts
// B3.1：MCP 运行时反代（opencode serve 2.1 的 v2 API）。
//
// 关键实证（2026-10-28，二进制路由表 + live 探测）：
//   serve 2.1 的 MCP API 不是 SDK 1.18 类型里的 v1 形态（/mcp/:name/connect → 404），而是：
//     GET    /api/mcp?location=            → {location, data:[{name, status:{status}}]}   （列表/状态）
//     GET    /api/mcp/resource             → 资源目录
//     PUT    /api/experimental/mcp/:server → add/upsert（body {config}，立即连接）
//     DELETE /api/experimental/mcp/:server → remove
//     POST   /api/experimental/mcp/:server/connect    → 204
//     POST   /api/experimental/mcp/:server/disconnect → 204
//   OAuth：无独立 HTTP 认证路由（v2 提示在 opencode /mcps 内登录）。
//
// 另：反代 URL 必须 `${apiBase}${path}` 字符串拼接；`new URL('/mcp', base+'/api')`
// 会丢掉 /api（曾据此误判「serve 无 MCP 端点」，2026-10-28 复核修正）。
//
// 本路由只做只读 + 运行时连接/断开（不改配置）。PUT/DELETE（增删）留 B4，需批准写入边界。
import * as http from 'http';

export interface McpRuntimeDeps {
  fetchServe(
    path: string,
    init?: { method?: string; body?: string },
  ): Promise<{ status: number; body: any }>;
}

function json(res: http.ServerResponse, status: number, payload: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

const ACTION_RE = /^\/api\/mcp\/([^/]+)\/(connect|disconnect)(?:\?|$)/;

export async function handleMcpRuntime(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  deps: McpRuntimeDeps,
): Promise<boolean> {
  // 状态（/api/mcp 精确匹配；/api/mcp/servers 由 mcp-list 路由先消费）
  if (req.method === 'GET' && /^\/api\/mcp(?:\?|$)/.test(url)) {
    const q = url.includes('?') ? url.slice(url.indexOf('?')) : '';
    try {
      const r = await deps.fetchServe(`/mcp${q}`, { method: 'GET' });
      json(res, r.status, r.body);
    } catch (err: any) {
      json(res, 502, { error: err?.message ?? String(err) });
    }
    return true;
  }

  if (req.method === 'POST') {
    const m = url.match(ACTION_RE);
    if (!m) return false;
    const name = decodeURIComponent(m[1] ?? '').trim();
    if (!name) return false;
    const action = m[2];
    const q = url.includes('?') ? url.slice(url.indexOf('?')) : '';
    try {
      const r = await deps.fetchServe(`/experimental/mcp/${encodeURIComponent(name)}/${action}${q}`, {
        method: 'POST',
      });
      json(res, r.status, r.body);
    } catch (err: any) {
      json(res, 502, { error: err?.message ?? String(err) });
    }
    return true;
  }

  return false;
}
