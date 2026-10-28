// gateway/src/routes/mcp.ts
// MCP 管理 HTTP 门面（runtime-neutral）。
// gateway 只做：能力门 → 调用 RuntimeMcpChannel → 返回 JSON。
// opencode 的 v2 HTTP / CLI / 配置文档细节在 runtime/opencode-mcp.ts（适配器层）。
import * as http from 'http';
import type { RuntimeMcpServer } from '../runtime/contract';

export interface McpRouteDeps {
  /** capabilities.mcpApi && runtime.mcp 是否可用（pi/minimal = false）。 */
  supported: boolean;
  list(opts?: { directory?: string }): Promise<RuntimeMcpServer[]>;
  connect(name: string, opts?: { directory?: string }): Promise<boolean>;
  disconnect(name: string, opts?: { directory?: string }): Promise<boolean>;
}

function json(res: http.ServerResponse, status: number, payload: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

const ACTION_RE = /^\/api\/mcp\/([^/]+)\/(connect|disconnect)(?:\?|$)/;

function directoryOf(url: string): string | undefined {
  const q = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
  if (!q) return undefined;
  const v = new URLSearchParams(q).get('directory');
  return v && v.trim() ? v : undefined;
}

export async function handleMcp(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  deps: McpRouteDeps,
): Promise<boolean> {
  if (req.method === 'GET' && /^\/api\/mcp\/servers(?:\?|$)/.test(url)) {
    if (!deps.supported) {
      json(res, 503, { error: 'runtime does not support MCP management' });
      return true;
    }
    try {
      const servers = await deps.list({ directory: directoryOf(url) });
      json(res, 200, { servers });
    } catch (err: any) {
      json(res, 502, { error: err?.message ?? String(err) });
    }
    return true;
  }

  if (req.method === 'POST') {
    const m = url.match(ACTION_RE);
    if (!m) return false;
    if (!deps.supported) {
      json(res, 503, { error: 'runtime does not support MCP management' });
      return true;
    }
    const name = decodeURIComponent(m[1] ?? '').trim();
    if (!name) return false;
    const action = m[2] as 'connect' | 'disconnect';
    try {
      const ok = action === 'connect'
        ? await deps.connect(name, { directory: directoryOf(url) })
        : await deps.disconnect(name, { directory: directoryOf(url) });
      if (ok) json(res, 200, { ok: true });
      else json(res, 502, { error: `${action} failed`, name });
    } catch (err: any) {
      json(res, 502, { error: err?.message ?? String(err) });
    }
    return true;
  }

  return false;
}
