import * as fs from "fs";
import * as path from "path";
import { ToolHandler } from "../../types";
import { eventBus } from "../../event-bus";

export const handleCreateGoal: ToolHandler = async (args, services) => {
  try {
    const requestedProjectDir = args.projectDir as string | undefined;
    const listProjects = (services as any)?.listProjects as
      (() => Array<{ projectDir: string; mafwDir: string }>) | undefined;
    let projectDir: string;
    let mafwDir: string;
    if (requestedProjectDir && listProjects) {
      const hit = listProjects().find((p) => p.projectDir === path.resolve(requestedProjectDir));
      if (!hit) {
        const available = listProjects().map((p) => p.projectDir).join(', ');
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `projectDir not registered: ${requestedProjectDir}. Available: ${available || '(none)'}` }) }], isError: true };
      }
      projectDir = hit.projectDir;
      mafwDir = hit.mafwDir;
    } else {
      // 调用时读取（非模块顶层）：测试需要按用例隔离 MAFW_PROJECT_DIR
      projectDir = process.env.MAFW_PROJECT_DIR || process.cwd();
      mafwDir = path.join(projectDir, ".mafw");
    }
    const goalId = args.goalId as string;
    const title = args.title as string;
    const charter = args.charter as string;
    const source = (args.source as string) || "user";
    const metrics = (args.metrics as Record<string, { target: number; unit: string }>) || {};
    const boundaries = (args.boundaries as string[]) || [];
    const priority = (args.priority as string) || "medium";
    const maxLoops = (args.maxLoops as number) || 5;
    const budget = (args.budget as { maxTurns?: number; maxCostUsd?: number } | undefined);
    const hasBudget = !!budget && (typeof budget.maxTurns === 'number' || typeof budget.maxCostUsd === 'number');
    // D4b: optional task type (validated against the canonical enum; plan node
    // may refine it later — its waves.taskType write-back wins).
    const taskType = args.taskType as string | undefined;
    const { isTaskType } = await import("../../orchestration/capability-ledger.js");
    if (taskType !== undefined && !isTaskType(taskType)) {
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `invalid taskType: ${taskType} (feature|bugfix|refactor|research|docs|test|other)` }) }], isError: true };
    }

    const goalsDir = path.join(mafwDir, "goals");
    const requestsDir = path.join(mafwDir, "requests");
    fs.mkdirSync(goalsDir, { recursive: true });
    fs.mkdirSync(requestsDir, { recursive: true });

    const charterPath = path.join(goalsDir, `${goalId}.md`);
    if (fs.existsSync(charterPath)) {
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `Goal ${goalId} already exists` }) }], isError: true };
    }

    fs.writeFileSync(charterPath, charter, "utf-8");

    const request = {
      version: "2", goalId, title, state: "draft",
      createdAt: new Date().toISOString(), confirmedAt: new Date().toISOString(),
      source, projectDir, mafwDir, goalCharter: charterPath,
      metrics, boundaries, priority, maxLoops, parallel: false,
      degradeOnLoop: Math.ceil(maxLoops * 0.6),
      ...(hasBudget ? { budget } : {}),
      ...(taskType ? { taskType } : {}),
    };

    const requestPath = path.join(requestsDir, `${goalId}.json`);
    fs.writeFileSync(requestPath, JSON.stringify(request, null, 2), "utf-8");

    eventBus.emit("goal_created", { type: "goal_created", goalId, projectDir });

    return {
      content: [{ type: "text", text: JSON.stringify({ success: true, goalId, charterPath, requestPath }) }],
    };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
  }
};
