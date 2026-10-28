// gateway/src/routes/mcp-config.ts
// MCP 配置写入 HTTP 门面（runtime-neutral）。
// gateway 不碰文件/JSONC/备份：全部由 RuntimeMcpConfigChannel（适配器）实现。
import * as http from 'http';
import type { RuntimeMcpConfigResult } from '../runtime/contract';

export interface McpConfigRouteDeps {
  /** capabilities.mcpConfigApi && runtime.mcp.config 是否可用。 */
  supported: boolean;
  preview(input: any): Promise<any>;
  previewRemove(name: string): Promise<any>;
  apply(input: any): Promise<RuntimeMcpConfigResult>;
  remove(name: string, opts: any): Promise<RuntimeMcpConfigResult>;
  restore(opts: any): Promise<RuntimeMcpConfigResult>;
}

function json(res: http.ServerResponse, status: number, payload: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function statusFor(err: any): number {
  switch (err?.code) {
    case 'etag_mismatch':
      return 409;
    case 'exists':
    case 'type_mismatch':
    case 'invalid':
    case 'too_large':
      return 400;
    case 'not_found':
      return 404;
    default:
      return 500;
  }
}

async function readJson(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  const raw = Buffer.concat(chunks).toString('utf-8');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const err: any = new Error('invalid JSON body');
    err.code = 'invalid';
    throw err;
  }
}

const REMOVE_RE = /^\/api\/mcp\/config\/servers\/([^/?]+)(?:\?|$)/;

export async function handleMcpConfig(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  deps: McpConfigRouteDeps,
): Promise<boolean> {
  const isPreview = url.startsWith('/api/mcp/config/preview-remove') ? false : url.startsWith('/api/mcp/config/preview');
  const isPreviewRemove = url.startsWith('/api/mcp/config/preview-remove');
  const isApply = url.startsWith('/api/mcp/config/apply');
  const isRestore = url.startsWith('/api/mcp/config/restore');
  const removeMatch = req.method === 'DELETE' ? url.match(REMOVE_RE) : null;
  if (!isPreview && !isPreviewRemove && !isApply && !isRestore && !removeMatch) return false;

  if (!deps.supported) {
    json(res, 503, { error: 'runtime does not support MCP config write' });
    return true;
  }

  try {
    if (isPreview && req.method === 'POST') {
      json(res, 200, await deps.preview(await readJson(req)));
      return true;
    }
    if (isPreviewRemove && req.method === 'POST') {
      const body = await readJson(req);
      if (!body?.name) { json(res, 400, { error: 'name is required' }); return true; }
      json(res, 200, await deps.previewRemove(String(body.name)));
      return true;
    }
    if (isApply && req.method === 'POST') {
      const body = await readJson(req);
      if (body?.confirm !== true) { json(res, 400, { error: 'confirm:true is required' }); return true; }
      json(res, 200, await deps.apply(body));
      return true;
    }
    if (isRestore && req.method === 'POST') {
      const body = await readJson(req);
      if (body?.confirm !== true) { json(res, 400, { error: 'confirm:true is required' }); return true; }
      json(res, 200, await deps.restore(body));
      return true;
    }
    if (removeMatch) {
      const name = decodeURIComponent(removeMatch[1] ?? '').trim();
      if (!name) { json(res, 400, { error: 'name is required' }); return true; }
      const body = await readJson(req);
      if (body?.confirm !== true) { json(res, 400, { error: 'confirm:true is required' }); return true; }
      json(res, 200, await deps.remove(name, body));
      return true;
    }
    return false;
  } catch (err: any) {
    json(res, statusFor(err), { error: err?.message ?? String(err), code: err?.code });
    return true;
  }
}
