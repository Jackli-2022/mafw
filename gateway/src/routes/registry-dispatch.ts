/**
 * P0-1: registry dispatch 鉴权门。
 *
 * RouteRegistry 挂 handler 的路由（pods/work/协作面等 registry-attached 端点）
 * 必须与 legacy 链一样先过 apiToken 鉴权：loopback 豁免，非 loopback 必须
 * Bearer / X-API-Token / ?token= 三通道之一（空 apiToken = 远端全拒）。
 *
 * 返回 true = 已处理（含 401 短路）；false = 无匹配/未处理，落回 legacy 链。
 * 详见 docs/superpowers/plans/2026-11-05-mobile-gateway-p0.md Task 1。
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { authorizeRequest } from '../core/auth';
import type { RouteRegistry } from './registry';

export interface DispatchAuthorizedDeps {
  registry: RouteRegistry;
  apiToken: string;
}

export async function dispatchAuthorized(
  deps: DispatchAuthorizedDeps,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const matched = deps.registry.match(req.method as never, req.url || '');
  if (!matched?.def.handler) return false;

  const remoteAddress = req.socket?.remoteAddress || '';
  const allowed = authorizeRequest(
    {
      remoteAddress,
      headers: req.headers as any,
      url: req.url,
      host: String(req.headers.host || ''),
    },
    deps.apiToken,
  );
  if (!allowed) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return true;
  }

  const handled = await matched.def.handler(req, res, matched.params);
  return handled !== false;
}
