/**
 * E7-1: unified human-only gate for the deferred mutation routes.
 *
 * E5a-2 gave pods / decisions / standing-goals their own local helpers. This is
 * the shared shape for routes wired through `routes/*.ts` closures, which have
 * the raw `IncomingMessage` but no access to the gateway class:
 *
 *   if (!requireHumanPrincipal(req, res)) return;
 *
 * Fail-closed: a missing principal (direct handler call without the transport)
 * is denied exactly like service/local/anonymous. The body is the stable
 * `humanOnlyDenied()` payload so clients keep matching on `code`.
 *
 * Read-only / advisory surfaces on the same paths (GET plan, triage.list,
 * triage.propose, lead list/observe, permissions.list) must NOT call this.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { humanOnlyDenied, isHumanPrincipal } from '../auth';

export function requireHumanPrincipal(req: IncomingMessage, res: ServerResponse): boolean {
  if (isHumanPrincipal((req as any).mafwPrincipal)) return true;
  const denied = humanOnlyDenied();
  res.writeHead(denied.status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(denied.body));
  return false;
}
