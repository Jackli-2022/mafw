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
import { errorBody, API_ERROR_CODES } from '../core/http/api-error';
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
  // Webhook senders authenticate with HMAC inside the handler, not the
  // gateway apiToken (GitHub/Slack cannot send a MAFW bearer token).
  const hmacAuthenticated = matched.def.operationId === 'events.webhook.receive';
  // E5a-3: pairing verify is credential-less by design (the single-use nonce is
  // the credential) — but ONLY through the transport, which sets
  // `mafwPairingVerify` after applying its body cap. A direct dispatcher cannot
  // self-authorize by operation id (F6).
  const pairingVerify = matched.def.operationId === 'mobile.pairingVerify'
    && (req as any).mafwPairingVerify === true;
  // E5a: the transport already resolved a principal for every request; a
  // human/device credential must reach registry routes too (it is not a
  // shared apiToken). `authorizeRequest` stays for callers that dispatch
  // without going through the transport (older tests / internal wiring).
  const principal = (req as any).mafwPrincipal as { kind?: unknown } | undefined;
  // F3: explicit allowlist — a malformed / unknown principal must not silently
  // pass just because it isn't `anonymous`. `authorizeRequest` is still the
  // fallback for dispatchers that never resolved a principal.
  const kind = principal?.kind;
  const principalAllowed = typeof kind === 'string'
    && (kind === 'human' || kind === 'service' || kind === 'local' || kind === 'relay');
  // M0: relay is allowlisted by the transport before dispatch. If a caller
  // reaches this gate without that check, never let loopback re-authorize it.
  const loopbackFallback = kind === 'relay'
    ? false
    : authorizeRequest(
      {
        remoteAddress,
        headers: req.headers as any,
        url: req.url,
        host: String(req.headers.host || ''),
      },
      deps.apiToken,
    );
  const allowed = hmacAuthenticated
    || pairingVerify
    || principalAllowed
    || loopbackFallback;
  if (!allowed) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(errorBody('unauthorized', API_ERROR_CODES.unauthorized)));
    return true;
  }

  const handled = await matched.def.handler(req, res, matched.params);
  return handled !== false;
}
