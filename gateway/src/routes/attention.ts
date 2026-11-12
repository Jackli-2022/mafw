import type { IncomingMessage, ServerResponse } from 'http';
import type { RouteRegistry } from './registry';
import { appendReviewAttention, deriveAttention, type ReviewAttentionInput } from '../core/lead/attention';
import type { PodGoalView } from '../core/pod/pod-view';

export interface AttentionRouteDeps {
  views(projectDir: string): PodGoalView[];
  reviews?(projectDir: string, views: readonly PodGoalView[]): ReviewAttentionInput[];
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
  const items = appendReviewAttention(deriveAttention(views), reviews);
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
