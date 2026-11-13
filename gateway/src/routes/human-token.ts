/**
 * E11-1: human token rotation (`POST /api/human-token/rotate`).
 *
 * Rotation replaces the single credential every human-only route trusts, so it
 * is stricter than a human-only route: the caller must be a `human` principal
 * whose **method is `human-token`**.
 *
 *   - device token  → a paired phone could otherwise invalidate the desktop
 *   - service       → agents / MCP / automations must never rotate a human credential
 *   - loopback      → credential-less local clients are not a human (deny even on
 *                     127.0.0.1: proving possession is the whole point)
 *   - anonymous     → no principal at all
 *
 * Denials reuse the stable `human_principal_required` 403 body (`humanOnlyDenied`),
 * and run before any file access. The new token is written atomically before the
 * response; the kernel dep binds it live so the next request already sees the
 * new value (spec §1).
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { humanOnlyDenied, type Principal } from '../core/auth';
import type { RouteRegistry } from './registry';

export interface HumanTokenRouteDeps {
  /**
   * Rotate the credential on disk and bind it to the live `humanToken`, then
   * return the new token. Must throw when the write fails — in that case the
   * caller's live token and the file must both stay unchanged.
   */
  rotate(): string;
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

export function attachHumanTokenRoutes(registry: RouteRegistry, deps: HumanTokenRouteDeps): void {
  registry.attachHandler('humanToken.rotate', (req: IncomingMessage, res: ServerResponse) => {
    const principal = (req as IncomingMessage & { mafwPrincipal?: Principal }).mafwPrincipal;
    if (!(principal?.kind === 'human' && principal.method === 'human-token')) {
      const denied = humanOnlyDenied();
      json(res, denied.status, denied.body);
      return;
    }

    let token: string;
    try {
      token = deps.rotate();
    } catch (err: any) {
      // The rotation is atomic: on failure the old token is still the only valid
      // credential, so the client can simply retry. Never echo a credential back.
      json(res, 500, { error: err?.message ?? String(err) });
      return;
    }

    json(res, 200, { token, rotatedAt: new Date().toISOString() });
  });
}
