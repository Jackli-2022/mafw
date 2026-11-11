// Gateway MCP: Tech Lead responds to a human review item (Plan C).
// Only the Goal-bound Tech Lead session may call it; resolving stays human-only.
import type { ToolHandler } from '../../types';
import { PodError } from '../../core/pod/pod-store';
import type { PodReviewService } from '../../core/pod/pod-review-service';

export interface PodReviewRespondArgs {
  goalId?: string;
  itemId?: string;
  response?: string;
  sessionID?: string;
}

type PodReviewRespondDeps = Pick<PodReviewService, 'respond'>;

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function ok(payload: Record<string, unknown>) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

function fail(error: unknown) {
  const status = typeof (error as any)?.status === 'number' ? (error as any).status : undefined;
  const payload = {
    success: false,
    ...(status ? { status } : {}),
    error: String((error as any)?.message ?? error),
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    isError: true,
    structuredContent: payload,
  };
}

function resolveDeps(services: any): {
  review: PodReviewRespondDeps;
  goalPodId(goalId: string): string | null;
} | null {
  const review = services?.podReview ?? services?.podCollaboration?.review;
  const goalPodId = services?.podGoalPodId
    ?? ((goalId: string) => services?.podStore?.getGoalByGoalId?.(goalId)?.podId ?? null);
  if (!review || typeof review.respond !== 'function') return null;
  return { review, goalPodId };
}

export const handlePodReviewRespond: ToolHandler = async (args, services) => {
  const deps = resolveDeps(services);
  if (!deps) return fail(new PodError(503, 'review item response is unavailable'));
  const input = args as PodReviewRespondArgs;
  const goalId = clean(input?.goalId);
  const itemId = clean(input?.itemId);
  const response = clean(input?.response);
  const sessionID = clean(input?.sessionID)
    || clean((services as any)?.sessionID);
  if (!goalId) return fail(new PodError(400, 'goalId is required'));
  if (!itemId) return fail(new PodError(400, 'itemId is required'));
  if (!response) return fail(new PodError(400, 'response is required'));
  if (!sessionID) return fail(new PodError(403, 'tech lead session is required'));
  const podId = deps.goalPodId(goalId);
  if (!podId) return fail(new PodError(404, `goal not found: ${goalId}`));
  try {
    const item = await deps.review.respond(podId, goalId, itemId, { sessionID, response });
    return ok({ success: true, itemId: item.id, status: item.status });
  } catch (error) {
    return fail(error);
  }
};
