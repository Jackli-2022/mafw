import * as fs from "fs";
import * as path from "path";
import { ToolHandler } from "../../types";
import { eventBus } from "../../event-bus";

const projectDir = process.env.MAFW_PROJECT_DIR || process.cwd();

export const handleCreateGoal: ToolHandler = async (args) => {
  try {
    const goalId = args.goalId as string;
    const title = args.title as string;
    const charter = args.charter as string;
    const source = (args.source as string) || "user";
    const metrics = (args.metrics as Record<string, { target: number; unit: string }>) || {};
    const boundaries = (args.boundaries as string[]) || [];
    const priority = (args.priority as string) || "medium";
    const maxLoops = (args.maxLoops as number) || 5;

    const mafwDir = path.join(projectDir, ".opencode/mafw");
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
