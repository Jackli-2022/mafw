/**
 * M0: the relay principal is the mobile surface, not a second local client.
 *
 * The allowlist is method+path, not a broad prefix: the reverse proxy removes
 * dot segments, so a prefix like `/api/mobile/` would otherwise let
 * `/api/mobile/../../api/pty` reach the runtime's native PTY surface. Paths
 * containing dot segments / encoded separators are rejected outright, and
 * only the routes the mobile client actually calls are listed.
 */
interface AllowRule {
  method: string;
  pattern: RegExp;
}

const ALLOWED_RULES: readonly AllowRule[] = [
  { method: 'GET', pattern: /^\/health$/ },
  { method: 'GET', pattern: /^\/api\/ws$/ },
  { method: 'GET', pattern: /^\/api\/presence$/ },
  // pairing / push registration / mobile media proxy
  { method: 'POST', pattern: /^\/api\/mobile\/pairing\/verify$/ },
  { method: 'POST', pattern: /^\/api\/mobile\/devices\/register$/ },
  { method: 'POST', pattern: /^\/api\/mobile\/media\/tasks$/ },
  { method: 'POST', pattern: /^\/api\/mobile\/media\/tasks\/[^/]+\/ask$/ },
  // projects + work overview + pod lookup/create
  { method: 'GET', pattern: /^\/api\/projects$/ },
  { method: 'GET', pattern: /^\/api\/projects\/[^/]+\/work$/ },
  { method: 'GET', pattern: /^\/api\/projects\/[^/]+\/pod\/lookup$/ },
  { method: 'POST', pattern: /^\/api\/projects\/[^/]+\/pod$/ },
  // sessions: list + history + create (no rename/data/permission-mode/revert)
  { method: 'GET', pattern: /^\/api\/sessions$/ },
  { method: 'GET', pattern: /^\/api\/sessions\/[^/]+\/messages$/ },
  { method: 'POST', pattern: /^\/api\/session$/ },
  { method: 'POST', pattern: /^\/api\/chat$/ },
  { method: 'POST', pattern: /^\/api\/chat\/enriched$/ },
  // memory search surfaces used by the work tab
  { method: 'GET', pattern: /^\/api\/memory\/search$/ },
  { method: 'GET', pattern: /^\/api\/memory\/energy-distribution$/ },
  // pod detail / goals / collaboration
  { method: 'GET', pattern: /^\/api\/pods\/[^/]+$/ },
  { method: 'GET', pattern: /^\/api\/pods\/[^/]+\/goals$/ },
  { method: 'POST', pattern: /^\/api\/pods\/[^/]+\/goals$/ },
  { method: 'POST', pattern: /^\/api\/pods\/[^/]+\/goals\/handoff$/ },
  { method: 'GET', pattern: /^\/api\/pods\/[^/]+\/goals\/[^/]+\/revisions$/ },
  { method: 'GET', pattern: /^\/api\/pods\/[^/]+\/goals\/[^/]+\/result$/ },
  { method: 'POST', pattern: /^\/api\/pods\/[^/]+\/goals\/[^/]+\/reject$/ },
  { method: 'GET', pattern: /^\/api\/pods\/[^/]+\/goals\/[^/]+\/tech-lead$/ },
  { method: 'POST', pattern: /^\/api\/pods\/[^/]+\/goals\/[^/]+\/tech-lead\/messages$/ },
  { method: 'POST', pattern: /^\/api\/pods\/[^/]+\/goals\/[^/]+\/direction-decision$/ },
  { method: 'POST', pattern: /^\/api\/pods\/[^/]+\/lead\/ensure$/ },
  { method: 'GET', pattern: /^\/api\/pods\/[^/]+\/events$/ },
  { method: 'POST', pattern: /^\/api\/pods\/[^/]+\/events\/[^/]+\/seen$/ },
  { method: 'POST', pattern: /^\/api\/pods\/[^/]+\/events\/seen$/ },
  { method: 'GET', pattern: /^\/api\/pods\/[^/]+\/sessions\/[^/]+\/transcript$/ },
  // goal plan / timeline / question answers (no `/api/goals/control`)
  { method: 'GET', pattern: /^\/api\/goals\/[^/]+\/timeline$/ },
  { method: 'GET', pattern: /^\/api\/goals\/[^/]+\/plan$/ },
  { method: 'POST', pattern: /^\/api\/goals\/[^/]+\/plan-approval$/ },
  { method: 'POST', pattern: /^\/api\/goals\/[^/]+\/questions\/[^/]+\/respond$/ },
  // pending questions / triage / event replay / TTS metadata
  { method: 'GET', pattern: /^\/api\/approvals$/ },
  { method: 'GET', pattern: /^\/api\/triage$/ },
  { method: 'POST', pattern: /^\/api\/triage\/[^/]+\/(confirm|reject|dismiss)$/ },
  { method: 'GET', pattern: /^\/api\/events\/replay$/ },
  { method: 'GET', pattern: /^\/api\/tts\/voices$/ },
];

function safePath(pathname: string): string | null {
  const raw = pathname.split('?')[0] || '/';
  if (raw.includes('\\')) return null;
  if (/(^|\/)\.{1,2}(\/|$)/.test(raw)) return null;
  if (/%2e|%2f|%5c/i.test(raw)) return null;
  let canonical: string;
  try {
    canonical = new URL(raw, 'http://localhost').pathname;
  } catch {
    return null;
  }
  if (canonical !== raw) return null;
  return raw.replace(/\/+$/, '') || '/';
}

export function isRelayAllowed(method: string, pathname: string): boolean {
  const path = safePath(pathname);
  if (!path) return false;
  const upper = method.toUpperCase();
  return ALLOWED_RULES.some((rule) => rule.method === upper && rule.pattern.test(path));
}

/**
 * M0: with no credential, a tunneled request may only reach the health probe
 * and the nonce-based pairing exchange. Everything else needs a device token.
 */
export function isAnonymousRelayAllowed(method: string, pathname: string): boolean {
  const path = safePath(pathname);
  if (!path) return false;
  const upper = method.toUpperCase();
  if (upper === 'GET' && path === '/health') return true;
  if (upper === 'POST' && path === '/api/mobile/pairing/verify') return true;
  return false;
}
