import * as path from "path";
import { ToolHandler } from "../../types";
import { createGoalIntake } from "../../core/goal/goal-intake";
import { eventBus } from "../../event-bus";

export const handleCreateGoal: ToolHandler = async (args, services) => {
  try {
    const requestedProjectDir = args.projectDir as string | undefined;
    const listProjects = (services as any)?.listProjects as
      (() => Array<{ projectDir: string; mafwDir: string }>) | undefined;

    const result = createGoalIntake({
      goalId: args.goalId as string,
      title: args.title as string,
      charter: args.charter as string,
      projectDir: requestedProjectDir,
      acceptance: Array.isArray(args.acceptance) ? args.acceptance : undefined,
      boundaries: Array.isArray(args.boundaries) ? args.boundaries : undefined,
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
      resolveProject: (requested) => {
        if (requested && listProjects) {
          const hit = listProjects().find((p) => p.projectDir === path.resolve(requested));
          if (!hit) return null;
          return { projectDir: hit.projectDir, mafwDir: hit.mafwDir };
        }
        // 调用时读取（非模块顶层）：测试需要按用例隔离 MAFW_PROJECT_DIR
        const projectDir = process.env.MAFW_PROJECT_DIR || process.cwd();
        return { projectDir, mafwDir: path.join(projectDir, ".mafw") };
      },
      now: () => new Date().toISOString(),
      emitGoalCreated: (event) => eventBus.emit("goal_created", event as any),
    });

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: true,
          goalId: result.goalId,
          charterPath: result.charterPath,
          requestPath: result.requestPath,
        }),
      }],
    };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
  }
};

function normalizeSource(value: unknown): 'desktop' | 'lead' | 'a2a' | 'automation' | 'user' {
  return value === 'desktop' || value === 'lead' || value === 'a2a' || value === 'automation' || value === 'user'
    ? value
    : 'user';
}
