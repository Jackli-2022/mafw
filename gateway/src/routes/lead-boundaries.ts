import type { IncomingMessage, ServerResponse } from 'http';
import type { RouteRegistry } from './registry';
import { readRouteBody } from './cognition';
import { requireHumanPrincipal } from '../core/http/human-guard';
import type { LeadBoundaryService } from '../core/lead/lead-boundary-service';
import type { TopicBoundaryRow } from '../core/lead/topic-boundary-store';

export interface LeadBoundaryRouteDeps {
  service: Pick<LeadBoundaryService, 'list' | 'accept' | 'merge' | 'undo'>;
  observe?(input: { sessionID: string; text: string }): unknown;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function fail(err: any): { status: number; body: { error: string } } {
  const status = typeof err?.status === 'number' ? err.status : 500;
  return { status, body: { error: String(err?.message ?? err) } };
}

export function handleListBoundaries(
  args: { id?: string },
  deps: LeadBoundaryRouteDeps,
): { status: number; body: { items: TopicBoundaryRow[] } | { error: string } } {
  const id = clean(args?.id);
  if (!id) return { status: 400, body: { error: 'topic id is required' } };
  return { status: 200, body: { items: deps.service.list(id) } };
}

function decide(
  args: { id?: string; bid?: string },
  deps: LeadBoundaryRouteDeps,
  run: (topicId: string, boundaryId: string) => { status: number; body: any },
): { status: number; body: any } {
  const topicId = clean(args?.id);
  const boundaryId = clean(args?.bid);
  if (!topicId || !boundaryId) {
    return { status: 400, body: { error: 'topic and boundary ids are required' } };
  }
  try {
    return run(topicId, boundaryId);
  } catch (err: any) {
    return fail(err);
  }
}

export function handleAcceptBoundary(
  args: { id?: string; bid?: string },
  deps: LeadBoundaryRouteDeps,
): { status: number; body: any } {
  return decide(args, deps, (topicId, boundaryId) => ({
    status: 200,
    body: deps.service.accept(topicId, boundaryId),
  }));
}

export function handleMergeBoundary(
  args: { id?: string; bid?: string },
  deps: LeadBoundaryRouteDeps,
): { status: number; body: any } {
  return decide(args, deps, (topicId, boundaryId) => ({
    status: 200,
    body: deps.service.merge(topicId, boundaryId),
  }));
}

export function handleUndoBoundary(
  args: { id?: string; bid?: string },
  deps: LeadBoundaryRouteDeps,
): { status: number; body: any } {
  return decide(args, deps, (topicId, boundaryId) => ({
    status: 200,
    body: deps.service.undo(topicId, boundaryId),
  }));
}

export function attachLeadBoundaryRoutes(registry: RouteRegistry, deps: LeadBoundaryRouteDeps): void {
  const send = (res: ServerResponse, out: { status: number; body: unknown }): void => {
    res.writeHead(out.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(out.body));
  };

  registry.attachHandler('lead.boundaries.list', async (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    send(res, handleListBoundaries({ id: params.id }, deps));
  });
  for (const [operation, handler] of [
    ['lead.boundaries.accept', handleAcceptBoundary],
    ['lead.boundaries.merge', handleMergeBoundary],
    ['lead.boundaries.undo', handleUndoBoundary],
  ] as const) {
    registry.attachHandler(operation, async (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
      // E7-1: accepting / merging / undoing a boundary is a human decision;
      // list + observe (advisory proposal) stay ordinary routes.
      if (!requireHumanPrincipal(req, res)) return;
      send(res, handler({ id: params.id, bid: params.bid }, deps));
    });
  }
  registry.attachHandler('lead.boundaries.observe', async (req: IncomingMessage, res: ServerResponse) => {
    let body: any = {};
    try { body = JSON.parse(await readRouteBody(req) || '{}'); } catch { body = {}; }
    const sessionID = clean(body?.sessionID);
    const text = typeof body?.text === 'string' ? body.text : '';
    if (!sessionID || !text || !deps.observe) {
      send(res, { status: 200, body: { proposed: false } });
      return;
    }
    try {
      const proposal = deps.observe({ sessionID, text });
      send(res, { status: 200, body: { proposed: !!proposal, proposal } });
    } catch (err: any) {
      // Observation is advisory and must never fail the chat turn.
      send(res, { status: 200, body: { proposed: false, error: String(err?.message ?? err) } });
    }
  });
}
