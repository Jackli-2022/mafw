// gateway/src/routes/mcp.ts
// MCP 管理 HTTP 门面（runtime-neutral）。
// gateway 只做：能力门 → 调用 RuntimeMcpChannel → 返回 JSON。
// opencode 的 v2 HTTP / CLI / 配置文档细节在 runtime/opencode-mcp.ts（适配器层）。
import * as http from 'http';
import type { RuntimeMcpServer } from '../runtime/contract';
import type { RuntimeAccess } from '../runtime/runtime-access';

export interface McpRouteDeps {
  /** canonical surface gate（mcp.list/connect/disconnect）；pi/minimal 自然为 false。 */
  access?: Pick<RuntimeAccess, 'can'> | null;
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
    if (!deps.access?.can('mcp.list')) {
      json(res, 503, { error: "runtime surface 'mcp.list' is not available" });
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
    const name = decodeURIComponent(m[1] ?? '').trim();
    if (!name) return false;
    const action = m[2] as 'connect' | 'disconnect';
    const surface = action === 'connect' ? 'mcp.connect' : 'mcp.disconnect';
    if (!deps.access?.can(surface)) {
      json(res, 503, { error: `runtime surface '${surface}' is not available` });
      return true;
    }
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
