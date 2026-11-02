// gateway/src/mcp/handlers/pod-goal-direction.ts
// Tech Lead 唯一的「方向裁定」出口（MCP: mafw_pod_goal_direction）。
//
// 语义（spec §5.1 / §10.1）：
// - `clear`：方向已经明确 → 记录一条 tech_lead_clear 决定（无用户 attention）→ 启动规划；
// - `decided`：用户已给出方向（原话逐字保留）→ 记录决定 → 启动规划；
// - `needs_user`：存在真实分歧 → 持久化 DirectionReview（pending attention）→ **不**启动规划。
//
// 权限：只有绑定在当前 Goal revision 的 Tech Lead 会话能调用（assertTechLeadSession）。
import type { ToolHandler } from '../../types';
import { PodError } from '../../core/pod/pod-store';
import type { PodTechLeadService } from '../../core/pod/pod-tech-lead-service';
import type { PodDirectionService } from '../../core/pod/pod-direction-service';
import type { DirectionOptionInput } from '../../core/goal/direction-decision';

export type PodGoalDirectionMode = 'clear' | 'needs_user' | 'decided';

export interface PodGoalDirectionArgs {
  goalId: string;
  mode: PodGoalDirectionMode;
  /** 用户原话（逐字保留）或 Tech Lead 的明确结论（clear）。 */
  userWords?: string;
  /** 用户选中的既有 option id。 */
  optionId?: string;
  options?: DirectionOptionInput[];
  reason?: string;
  /** MCP 调用者会话（opencode MCP 不传调用者身份，故显式参数；缺省时取调用上下文）。 */
  sessionID?: string;
}

export interface PodGoalDirectionContext {
  sessionID?: string;
}

export interface PodGoalDirectionDeps {
  techLead: Pick<PodTechLeadService, 'assertTechLeadSession'>;
  direction: Pick<PodDirectionService, 'decide' | 'request'>;
  /** 规划启动器（clear / decided 后调用；needs_user 绝不调用）。 */
  startPlanning(goalId: string): Promise<void> | void;
  now?(): string;
  log?(message: string): void;
}

export interface PodGoalDirectionToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function errorText(error: unknown): string {
  return String((error as any)?.message ?? error);
}

function ok(payload: Record<string, unknown>): PodGoalDirectionToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

function fail(error: unknown): PodGoalDirectionToolResult {
  const status = typeof (error as any)?.status === 'number' ? (error as any).status : undefined;
  const payload = {
    success: false,
    ...(status ? { status } : {}),
    error: errorText(error),
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    isError: true,
    structuredContent: payload,
  };
}

function normalizeMode(value: unknown): PodGoalDirectionMode {
  if (value === 'clear' || value === 'needs_user' || value === 'decided') return value;
  throw new PodError(400, 'mode must be clear | needs_user | decided');
}

export function createPodGoalDirectionTool(deps: PodGoalDirectionDeps) {
  return {
    async execute(
      args: PodGoalDirectionArgs,
      ctx: PodGoalDirectionContext = {},
    ): Promise<PodGoalDirectionToolResult> {
      const goalId = clean(args?.goalId);
      if (!goalId) throw new PodError(400, 'goalId is required');
      const mode = normalizeMode(args?.mode);
      const sessionID = clean(args?.sessionID) || clean(ctx.sessionID);
      if (!sessionID) {
        throw new PodError(403, `session is not the bound Tech Lead session for goal ${goalId}`);
      }
      const bound = deps.techLead.assertTechLeadSession(goalId, sessionID);

      if (mode === 'needs_user') {
        const options = Array.isArray(args?.options) ? args.options : [];
        if (options.length === 0) {
          throw new PodError(400, 'needs_user requires at least one direction option');
        }
        const result = deps.direction.request({
          goalId,
          options,
          reason: args?.reason ?? null,
          requestedBy: sessionID,
          revision: bound.revision,
        });
        const review = result.state.requests[result.state.requests.length - 1] ?? null;
        return ok({
          success: true,
          mode,
          goalId,
          revision: result.revision,
          revisionStatus: result.revisionStatus,
          directionStatus: result.directionStatus,
          decision: null,
          review,
          planningStarted: false,
        });
      }

      const userWords = typeof args?.userWords === 'string' ? args.userWords : '';
      const optionId = clean(args?.optionId) || null;
      if (!userWords.trim() && !optionId) {
        throw new PodError(400, `${mode} requires userWords or optionId`);
      }
      const result = deps.direction.decide({
        goalId,
        revision: bound.revision,
        decision: {
          userWords,
          optionId,
          reason: args?.reason ?? null,
          source: mode === 'clear' ? 'tech_lead_clear' : 'user',
          revision: bound.revision,
          decidedAt: deps.now?.() ?? new Date().toISOString(),
        },
      });

      let planningStarted = false;
      let planningError: string | undefined;
      try {
        await deps.startPlanning(goalId);
        planningStarted = true;
      } catch (error) {
        // 决定已持久化（append-only）；启动失败要可观测，但不能回滚用户方向。
        planningError = errorText(error);
        deps.log?.(`[Pod] planning start failed for ${goalId} after ${mode}: ${planningError}`);
      }

      return ok({
        success: true,
        mode,
        goalId,
        revision: result.revision,
        revisionStatus: result.revisionStatus,
        directionStatus: result.directionStatus,
        decision: result.decision,
        planningStarted,
        ...(planningError ? { planningError } : {}),
      });
    },
  };
}

function resolveDeps(services: any): PodGoalDirectionDeps | null {
  const bundle = services?.podGoalDirection ?? services?.podCollaboration?.goalDirection;
  if (bundle) return bundle as PodGoalDirectionDeps;
  const techLead = services?.podTechLead ?? services?.podCollaboration?.techLead;
  const direction = services?.podDirection ?? services?.podCollaboration?.direction;
  const startPlanning = services?.startGoalPlanning ?? services?.podCollaboration?.startPlanning;
  if (techLead && direction && typeof startPlanning === 'function') {
    return { techLead, direction, startPlanning };
  }
  return null;
}

/** MCP handler：组合根把依赖放进 services（podGoalDirection 或 podCollaboration.*）。 */
export const handlePodGoalDirection: ToolHandler = async (args, services) => {
  const deps = resolveDeps(services);
  if (!deps) {
    return fail(new PodError(503, 'pod goal direction is unavailable'));
  }
  const tool = createPodGoalDirectionTool(deps);
  try {
    return await tool.execute(args as unknown as PodGoalDirectionArgs, {
      sessionID: typeof args?.sessionID === 'string'
        ? args.sessionID
        : (typeof (services as any)?.sessionID === 'string' ? (services as any).sessionID : undefined),
    });
  } catch (error) {
    return fail(error);
  }
};
