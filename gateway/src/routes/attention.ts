import type { IncomingMessage, ServerResponse } from 'http';
import type { RouteRegistry } from './registry';
import {
  appendDecisionAttention,
  appendReviewAttention,
  deriveAttention,
  type ReviewAttentionInput,
} from '../core/lead/attention';
import type { DecisionRecord } from '../core/decision/decision-record';
import type { PodGoalView } from '../core/pod/pod-view';

export interface AttentionRouteDeps {
  views(projectDir: string): PodGoalView[];
  reviews?(projectDir: string, views: readonly PodGoalView[]): ReviewAttentionInput[];
  decisions?(projectDir: string): DecisionRecord[];
}

function projectDirOf(value: unknown): string {
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : process.env.MAFW_PROJECT_DIR || process.cwd();
}

/** GET /api/attention — person-first list; count is the list length. */
export function handleAttention(
  args: { projectDir?: string },
  deps: AttentionRouteDeps,
): { status: number; body: { items: ReturnType<typeof deriveAttention> } } {
  const projectDir = projectDirOf(args?.projectDir);
  const views = deps.views(projectDir);
  const reviews = deps.reviews?.(projectDir, views) ?? [];
  const decisions = deps.decisions?.(projectDir) ?? [];
  const items = appendDecisionAttention(
    appendReviewAttention(deriveAttention(views), reviews),
    decisions,
  );
  return { status: 200, body: { items } };
}

export function attachAttentionRoutes(registry: RouteRegistry, deps: AttentionRouteDeps): void {
  registry.attachHandler('attention.list', async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const out = handleAttention({ projectDir: url.searchParams.get('projectDir') ?? undefined }, deps);
    res.writeHead(out.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(out.body));
  });
}
