// gateway/src/routes/mcp-list.ts
// B3（W4 v1）：MCP 服务器状态——opencode 2.1 的 HTTP API 无 MCP 运行时端点
// （wire 实证：GET /api/mcp → SPA，POST /api/mcp/:name/connect → 405），
// 以官方 CLI `opencode mcp list` 为准解析状态。纯解析函数 + 路由分离。
import * as http from 'http';

export type McpListStatus = 'connected' | 'disabled' | 'failed' | 'needs_auth' | 'unknown';

export interface McpListEntry {
  name: string;
  status: McpListStatus;
  detail?: string;
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** 解析 `opencode mcp list` 输出：`✓ mafw  connected` / `✗ x  failed: …`。 */
export function parseMcpListOutput(text: string): McpListEntry[] {
  const out: McpListEntry[] = [];
  for (const rawLine of (text ?? '').split(/\r?\n/)) {
    const line = rawLine.replace(ANSI_RE, '').trim();
    if (!line) continue;
    const m = line.match(/^[✓✔✗×!]\s+(\S+)\s+(.+)$/);
    if (!m) continue;
    const name = m[1];
    const rest = m[2].trim();
    let status: McpListStatus = 'unknown';
    const low = rest.toLowerCase();
    if (low.startsWith('connected')) status = 'connected';
    else if (low.startsWith('disabled')) status = 'disabled';
    else if (low.startsWith('failed') || low.startsWith('error')) status = 'failed';
    else if (low.includes('auth') || low.includes('sign in') || low.includes('login')) status = 'needs_auth';
    out.push({ name, status, ...(rest.length > 24 ? { detail: rest.slice(0, 80) } : {}) });
  }
  return out;
}

/**
 * execFile 的 Windows shim 处置（wire 实证 2026-10-28）：
 * - `.ps1` 直跑 EFTYPE / shell 下 15s 挂死——不可用；
 * - `.cmd` 直跑同步抛 EINVAL，必须 shell:true；
 * - 官方全局布局的 `<prefix>/node_modules/@opencode/cli/bin/opencode.exe` 直跑最快（139ms）——优先。
 */
import * as path from 'path';

export interface McpListCommand {
  bin: string;
  shell: boolean;
}

export function resolveMcpListCommand(
  resolvedBin: string,
  exists: (p: string) => boolean,
): McpListCommand | null {
  if (!resolvedBin) return null;
  if (/\.(exe|com)$/i.test(resolvedBin) && exists(resolvedBin)) return { bin: resolvedBin, shell: false };
  // npm 全局 shim（.cmd/.ps1）旁边找官方 exe（@opencode/cli 布局）。
  const dir = path.dirname(resolvedBin);
  const exe = path.join(dir, 'node_modules', '@opencode', 'cli', 'bin', 'opencode.exe');
  if (exists(exe)) return { bin: exe, shell: false };
  if (/\.(cmd|bat)$/i.test(resolvedBin) && exists(resolvedBin)) return { bin: resolvedBin, shell: true };
  if (/\.(ps1)$/i.test(resolvedBin)) return null;
  return exists(resolvedBin) ? { bin: resolvedBin, shell: false } : null;
}

export interface McpListRouteDeps {
  /** 运行 `opencode mcp list` 并返回 stdout（fail-open：错误返回空串）。 */
  listMcpOutput(): Promise<string>;
}

function json(res: http.ServerResponse, status: number, payload: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

export async function handleMcpList(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  deps: McpListRouteDeps,
): Promise<boolean> {
  if (req.method !== 'GET' || !/^\/api\/mcp\/servers(?:\?|$)/.test(url)) return false;
  try {
    const text = await deps.listMcpOutput();
    json(res, 200, { servers: parseMcpListOutput(text) });
  } catch (err: any) {
    json(res, 200, { servers: [], error: err?.message ?? String(err) });
  }
  return true;
}
