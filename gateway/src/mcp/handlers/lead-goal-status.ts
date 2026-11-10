import type { ToolHandler } from '../../types';
import { buildLeadGoalStatus, type LeadGoalStatus } from '../../core/lead/goal-status';
import type { PodAttentionItem, PodGoalView } from '../../core/pod/pod-view';
import { PodError } from '../../core/pod/pod-store';

export interface LeadGoalStatusDeps {
  listViews(projectDir: string): PodGoalView[];
  attention(projectDir: string): PodAttentionItem[];
}

export interface LeadGoalStatusArgs {
  projectDir?: string;
  limit?: number;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function ok(payload: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

function fail(error: unknown) {
  const status = typeof (error as any)?.status === 'number' ? (error as any).status : undefined;
  const payload = { success: false, ...(status ? { status } : {}), error: String((error as any)?.message ?? error) };
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    isError: true,
    structuredContent: payload,
  };
}

export function createLeadGoalStatusTool(deps: LeadGoalStatusDeps) {
  return {
    async execute(args: LeadGoalStatusArgs, _ctx: { sessionID?: string } = {}) {
      const projectDir = clean(args.projectDir) || process.env.MAFW_PROJECT_DIR || process.cwd();
      const limit = Number.isFinite(args.limit) ? Math.max(1, Number(args.limit)) : 5;
      const goals: LeadGoalStatus[] = buildLeadGoalStatus(
        deps.listViews(projectDir),
        deps.attention(projectDir),
        limit,
      );
      return ok({ success: true, goals });
    },
  };
}

export const handleLeadGoalStatus: ToolHandler = async (args, services) => {
  const deps = (services as any)?.podGoalStatus as LeadGoalStatusDeps | undefined;
  if (!deps?.listViews || !deps?.attention) {
    return fail(new PodError(503, 'lead goal status is unavailable'));
  }
  return createLeadGoalStatusTool(deps).execute(args as unknown as LeadGoalStatusArgs);
};
