// gateway/src/routes/pod-events.ts
// Returns { status, body } (no ServerResponse) so the route logic is unit
// testable; index.ts owns the HTTP write.
export interface PodEventsServiceLike {
  list(podId: string, opts?: { state?: 'unread'; limit?: number }): { items: unknown[]; unread: number };
  markSeen(podId: string, id: string): boolean;
  markSeenAll(podId: string, goalId: string, revision: number): number;
}

export interface PodEventsRequest {
  method: string;
  podId: string;
  id?: string;
  action?: 'seenAll';
  query?: Record<string, string | undefined>;
  body?: any;
}

export interface PodEventsDeps {
  service: PodEventsServiceLike;
}

export function handlePodEvents(deps: PodEventsDeps) {
  return async (req: PodEventsRequest): Promise<{ status: number; body: unknown }> => {
    try {
      if (req.method === 'GET') {
        const state = req.query?.state === 'unread' ? 'unread' : undefined;
        const limit = Number(req.query?.limit) || 50;
        return { status: 200, body: deps.service.list(req.podId, { ...(state ? { state } : {}), limit }) };
      }
      if (req.method === 'POST' && req.action === 'seenAll') {
        const goalId = typeof req.body?.goalId === 'string' ? req.body.goalId : '';
        const revision = Number(req.body?.revision);
        if (!goalId || !Number.isFinite(revision)) {
          return { status: 400, body: { error: 'goalId and revision are required' } };
        }
        return { status: 200, body: { ok: true, changed: deps.service.markSeenAll(req.podId, goalId, revision) } };
      }
      if (req.method === 'POST' && req.id) {
        return { status: 200, body: { ok: true, changed: deps.service.markSeen(req.podId, req.id) } };
      }
      return { status: 404, body: { error: 'not found' } };
    } catch (err: any) {
      return { status: 500, body: { error: err?.message ?? 'pod events failed' } };
    }
  };
}
