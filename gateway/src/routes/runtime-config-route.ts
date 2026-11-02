/**
 * /api/runtime-config 路由（runtime 中立的运行时配置读写）。
 */
import http from 'http';

export interface RuntimeConfigRouteDeps {
  getConfig: () => Promise<unknown>;
  updateConfig: (patch: unknown) => Promise<unknown>;
}

export async function handleRuntimeConfigGet(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: RuntimeConfigRouteDeps,
): Promise<void> {
  const config = await deps.getConfig();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(config));
}

export async function handleRuntimeConfigPatch(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: RuntimeConfigRouteDeps,
): Promise<void> {
  const body = await new Promise<unknown>((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); }
    });
  });
  const result = await deps.updateConfig(body);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result));
}

/** 路由匹配：/api/runtime-config（旧别名 /api/opencode-config 已删除）。 */
export function matchRuntimeConfigRoute(url: string | undefined, method: string): 'get' | 'patch' | null {
  if (!url) return null;
  const m = url.match(/^\/api\/runtime-config(?:\?|$)/);
  if (!m) return null;
  if (method === 'GET') return 'get';
  if (method === 'PATCH') return 'patch';
  return null;
}
