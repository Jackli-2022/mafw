import * as path from "path";
import { ToolHandler } from "../../types";
import {
  createGoalIntake,
  GoalConflictError,
  type GoalIntakeResult,
} from "../../core/goal/goal-intake";
import { eventBus } from "../../event-bus";
import type {
  PodTechLeadGoalInput,
  PodTechLeadService,
} from "../../core/pod/pod-tech-lead-service";

export interface CreateGoalToolContext {
  sessionID?: string;
}

export interface CreateGoalToolDeps {
  /**
   * 组合根注入的 Tech Lead 服务。Lead 调用 `mafw_create_goal` 时 Goal 直接进入
   * discussing（隐藏 Tech Lead 会话 + ContextManifest），**不**启动 NodeDriver。
   */
  techLead?: Pick<PodTechLeadService, 'isLeadSession' | 'createGoal'> | null;
  intake?: typeof createGoalIntake;
  emitGoalCreated?(event: unknown): void;
  listProjects?(): Array<{ projectDir: string; mafwDir: string }>;
  now?(): string;
  log?(message: string): void;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function errorPayload(error: unknown): Record<string, unknown> {
  const status = typeof (error as any)?.status === 'number' ? (error as any).status : undefined;
  return {
    success: false,
    ...(status ? { status } : {}),
    error: String((error as any)?.message ?? error),
  };
}

function ok(payload: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

function fail(error: unknown) {
  const payload = errorPayload(error);
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    isError: true,
    structuredContent: payload,
  };
}

/**
 * `mafw_create_goal` 的共享实现（handler 与单测共用）：
 * - Tech Lead 存在且调用者是项目 Lead → 交给 `PodTechLeadService.createGoal`；
 * - 其它调用保持旧的 legacy intake 路径（显式 goalId/charter，autoStart 事件照旧）。
 *
 * Tech Lead 路由失败**绝不**回退 legacy：否则会绕过 Pod 讨论直接启动 NodeDriver。
 */
export function createCreateGoalTool(deps: CreateGoalToolDeps = {}) {
  const intake = deps.intake ?? createGoalIntake;
  const now = deps.now ?? (() => new Date().toISOString());

  return {
    async execute(args: Record<string, unknown>, ctx: CreateGoalToolContext = {}) {
      const requestedProjectDir = clean(args?.projectDir) || undefined;
      const sessionID = clean(args?.sessionID) || clean(ctx.sessionID);
      const title = clean(args?.title);
      const objective = typeof args?.objective === "string" ? args.objective : "";
      const charter = typeof args?.charter === "string" ? args.charter : "";

      if (deps.techLead && sessionID) {
        let isLead = false;
        try {
          isLead = deps.techLead.isLeadSession(sessionID);
        } catch (error: any) {
          deps.log?.(`[Goal] Lead lookup failed for ${sessionID}: ${error?.message ?? error}`);
          isLead = false;
        }
        if (isLead) {
          try {
            const created = await deps.techLead.createGoal({
              projectDir: requestedProjectDir
                ?? process.env.MAFW_PROJECT_DIR
                ?? process.cwd(),
              title,
              objective: objective || undefined,
              charter: charter || undefined,
              acceptance: Array.isArray(args.acceptance) ? args.acceptance as string[] : undefined,
              boundaries: Array.isArray(args.boundaries) ? args.boundaries as string[] : undefined,
              metrics: (args.metrics as Record<string, { target?: number; unit?: string }>) || undefined,
              priority: args.priority as PodTechLeadGoalInput['priority'],
              maxLoops: args.maxLoops as number | undefined,
              budget: args.budget as { maxTurns?: number; maxCostUsd?: number } | undefined,
              taskType: args.taskType as PodTechLeadGoalInput['taskType'],
              planReview: (args.planReview === "manual" || args.planReview === "auto")
                ? args.planReview
                : undefined,
              goalId: clean(args.goalId) || undefined,
              authorization: {
                source: "lead",
                requestMode: "explicit",
                scope: requestedProjectDir,
              },
              createdBy: sessionID,
            });
            return ok({ success: true, routedTo: "tech_lead", ...created });
          } catch (error) {
            return fail(error);
          }
        }
      }

      try {
        const result: GoalIntakeResult = intake({
          goalId: args.goalId as string,
          title: args.title as string,
          objective: objective || undefined,
          charter: charter || undefined,
          projectDir: requestedProjectDir,
          acceptance: Array.isArray(args.acceptance) ? args.acceptance as string[] : undefined,
          boundaries: Array.isArray(args.boundaries) ? args.boundaries as string[] : undefined,
          metrics: (args.metrics as Record<string, { target?: number; unit?: string }>) || {},
          priority: args.priority as any,
          maxLoops: args.maxLoops as number | undefined,
          budget: args.budget as { maxTurns?: number; maxCostUsd?: number } | undefined,
          taskType: args.taskType as any,
          planReview: args.planReview as any,
          source: (args.source as string) || "user",
          authorization: {
            source: normalizeSource(args.source),
            requestMode: "explicit",
          },
        }, {
          resolveProject: (requested) => resolveIntakeProject(
            requested,
            deps.listProjects,
          ),
          now,
          emitGoalCreated: (event) => deps.emitGoalCreated?.(event),
        });

        return ok({
          success: true,
          routedTo: "legacy",
          goalId: result.goalId,
          charterPath: result.charterPath,
          requestPath: result.requestPath,
          layout: result.layout,
          goalDir: result.goalDir,
        });
      } catch (err: any) {
        if (err instanceof GoalConflictError) {
          return fail({ status: 409, message: err.message });
        }
        return fail(err);
      }
    },
  };
}

/** 旧路径的项目解析（调用时读取 env/cwd：测试按用例隔离 MAFW_PROJECT_DIR）。 */
function resolveIntakeProject(
  requested: string | undefined,
  listProjects: (() => Array<{ projectDir: string; mafwDir: string }>) | undefined,
): { projectDir: string; mafwDir: string } | null {
  if (requested && listProjects) {
    const hit = listProjects().find((p) => p.projectDir === path.resolve(requested));
    if (!hit) return null;
    return { projectDir: hit.projectDir, mafwDir: hit.mafwDir };
  }
  const projectDir = process.env.MAFW_PROJECT_DIR || process.cwd();
  return { projectDir, mafwDir: path.join(projectDir, ".mafw") };
}

function techLeadFrom(services: any): CreateGoalToolDeps['techLead'] {
  return services?.podTechLead ?? services?.podCollaboration?.techLead ?? null;
}

export const handleCreateGoal: ToolHandler = async (args, services) => {
  const now = new Date().toISOString();
  const anyServices = services as any;
  const tool = createCreateGoalTool({
    techLead: techLeadFrom(services),
    listProjects: anyServices?.listProjects,
    emitGoalCreated: (event) => eventBus.emit("goal_created", event as any),
    now: () => now,
  });
  return tool.execute(args, {
    sessionID: typeof args?.sessionID === "string"
      ? args.sessionID
      : (typeof anyServices?.sessionID === "string" ? anyServices.sessionID : undefined),
  });
};

function normalizeSource(value: unknown): 'desktop' | 'lead' | 'a2a' | 'automation' | 'user' {
  return value === 'desktop' || value === 'lead' || value === 'a2a' || value === 'automation' || value === 'user'
    ? value
    : 'user';
}
