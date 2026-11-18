/**
 * M0: the relay principal is the mobile surface, not a second local client.
 * Allowlist is deny-first so `/api/mobile/tts` cannot slip through the
 * `/api/mobile/` prefix and `/api/tts/voices` can stay metadata-only.
 */
const EXACT_ALLOWED: ReadonlyArray<readonly [string, string]> = [
  ['GET', '/health'],
  ['GET', '/api/ws'],
  ['GET', '/api/tts/voices'],
];

const DENIED_PREFIXES = [
  '/a2a',
  '/dashboard',
  '/register',
  '/control',
  '/api/terminal',
  '/api/python',
  '/api/tools',
  '/api/cognition',
  '/api/media',
  '/api/file-history',
  '/api/mcp',
  '/api/plugins',
  '/api/config',
  '/api/human-token',
  '/api/devices',
  '/api/mobile/pairing-code',
  '/api/mobile/remote-access',
  '/api/mobile/tts',
  '/api/tts',
] as const;

const ALLOWED_PREFIXES = [
  '/api/presence',
  '/api/projects',
  '/api/sessions',
  '/api/session',
  '/api/chat/',
  '/api/memory/search',
  '/api/memory/energy-distribution',
  '/api/pods',
  '/api/goals',
  '/api/approvals',
  '/api/triage',
  '/api/events/replay',
  '/api/mobile/',
] as const;

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);
}

export function isRelayAllowed(method: string, pathname: string): boolean {
  const path = (pathname.split('?')[0] || '/').replace(/\/+$/, '') || '/';

  for (const [allowedMethod, allowedPath] of EXACT_ALLOWED) {
    if (path === allowedPath) return method.toUpperCase() === allowedMethod;
  }
  for (const prefix of DENIED_PREFIXES) {
    if (matchesPrefix(path, prefix)) return false;
  }
  for (const prefix of ALLOWED_PREFIXES) {
    if (matchesPrefix(path, prefix)) return true;
  }
  return false;
}
