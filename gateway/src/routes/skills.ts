/**
 * Skill v1 deopt route.
 *
 * Human/internal action: move an installed playbook out of discovery scope and
 * mark its registry row paused. The effect applies at the next discovery
 * boundary; already-injected instructions are not claimed to be retracted.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import type { RouteRegistry } from './registry';

export interface SkillRouteDeps {
  deopt(name: string, reason: string): { deopted: boolean; archivedTo?: string; error?: string };
  /** Registry rows joined with invocation stats (6B). */
  list?(): Array<Record<string, unknown>>;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: string) => { body += chunk; });
    req.on('end', () => resolve(body));
  });
}

export function attachSkillRoutes(registry: RouteRegistry, deps: SkillRouteDeps): void {
  registry.attachHandler('skills.list', async (_req: IncomingMessage, res: ServerResponse) => {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ skills: deps.list?.() ?? [] }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ skills: [], error: err?.message || String(err) }));
    }
  });

  registry.attachHandler('skills.deopt', async (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    try {
      let reason = 'manual';
      try {
        const parsed = JSON.parse((await readBody(req)) || '{}');
        if (typeof parsed?.reason === 'string' && parsed.reason.trim()) reason = parsed.reason.trim().slice(0, 200);
      } catch { /* default reason */ }
      const result = deps.deopt(String(params.name || ''), reason);
      if (!result.deopted) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ deopted: false, error: result.error || 'skill not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ deopted: true, archivedTo: result.archivedTo }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ deopted: false, error: err?.message || String(err) }));
    }
  });
}
